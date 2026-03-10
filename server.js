require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.json());

app.get('/api/documents', async (req, res) => {
    const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error });
    res.json(data);
});

app.post('/api/upload', async (req, res) => {
    try {
        const chunks = [];
        await new Promise((resolve, reject) => {
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', resolve);
            req.on('error', reject);
        });

        const body = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        const boundary = contentType.split('boundary=')[1];

        if (!boundary) {
            return res.status(400).json({ error: 'Boundary não encontrado' });
        }

        const boundaryBuffer = Buffer.from('--' + boundary);
        const parts = [];
        let start = 0;

        for (let i = 0; i < body.length; i++) {
            if (body.slice(i, i + boundaryBuffer.length).equals(boundaryBuffer)) {
                if (start !== 0) {
                    parts.push(body.slice(start, i - 2));
                }
                start = i + boundaryBuffer.length + 2;
            }
        }

        let fileBuffer = null;
        let originalName = '';

        for (const part of parts) {
            const headerEnd = part.indexOf('\r\n\r\n');
            if (headerEnd === -1) continue;

            const headerStr = part.slice(0, headerEnd).toString();
            const fileData = part.slice(headerEnd + 4);

            if (headerStr.includes('filename=')) {
                const match = headerStr.match(/filename="([^"]+)"/);
                if (match) originalName = match[1];
                fileBuffer = fileData;
            }
        }

        if (!fileBuffer || !originalName) {
            return res.status(400).json({ error: 'Arquivo não encontrado no upload' });
        }

        const fileName = `${Date.now()}_${originalName}`;
        console.log('Arquivo recebido:', originalName, 'Tamanho:', fileBuffer.length);

        const { error: uploadError } = await supabase.storage
            .from('documentos')
            .upload(fileName, fileBuffer, { contentType: 'application/pdf' });

        if (uploadError) {
            console.error('Erro Supabase storage:', uploadError);
            return res.status(500).json({ error: uploadError.message });
        }

        const { data: publicUrlData } = supabase.storage
            .from('documentos')
            .getPublicUrl(fileName);

        await supabase.from('documents').insert({
            name: originalName,
            file_path: fileName,
            public_url: publicUrlData.publicUrl
        });

        await fetch(process.env.N8N_WEBHOOK_INGESTAO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pdf_url: publicUrlData.publicUrl,
                document_id: fileName
            })
        });

        res.json({ success: true });

    } catch (err) {
        console.error('Erro no upload:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/documents/:id', async (req, res) => {
    const { id } = req.params;

    const { data: doc } = await supabase
        .from('documents')
        .select('file_path')
        .eq('id', id)
        .single();

    await supabase.storage.from('documentos').remove([doc.file_path]);
    await supabase.from('product_docs').delete().eq('document_id', doc.file_path);
    await supabase.from('documents').delete().eq('id', id);

    res.json({ success: true });
});

app.post('/api/generate', async (req, res) => {
    const { query } = req.body;

    const response = await fetch(process.env.N8N_WEBHOOK_BUSCA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    });

    const data = await response.json();
    res.json(data);
});

module.exports = app;

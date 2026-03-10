require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const app = express();

console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'OK' : 'MISSING');
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'OK' : 'MISSING');
console.log('N8N_WEBHOOK_INGESTAO:', process.env.N8N_WEBHOOK_INGESTAO ? 'OK' : 'MISSING');
console.log('N8N_WEBHOOK_BUSCA:', process.env.N8N_WEBHOOK_BUSCA ? 'OK' : 'MISSING');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.json());

app.get('/api/documents', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('documents')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Erro ao listar documentos:', error);
            return res.status(500).json({ error: error.message });
        }
        res.json(data);
    } catch (err) {
        console.error('Erro geral /api/documents:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/upload', async (req, res) => {
    console.log('--- INÍCIO DO UPLOAD ---');
    console.log('Content-Type:', req.headers['content-type']);
    try {
        const chunks = [];
        await new Promise((resolve, reject) => {
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', resolve);
            req.on('error', reject);
        });

        const body = Buffer.concat(chunks);
        console.log('Body recebido, tamanho:', body.length);

        const contentType = req.headers['content-type'] || '';
        const boundary = contentType.split('boundary=')[1];
        console.log('Boundary:', boundary);

        if (!boundary) {
            console.error('Boundary não encontrado');
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

        console.log('Partes encontradas:', parts.length);

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
                console.log('Arquivo encontrado:', originalName, 'Tamanho:', fileData.length);
            }
        }

        if (!fileBuffer || !originalName) {
            console.error('Arquivo não encontrado no body');
            return res.status(400).json({ error: 'Arquivo não encontrado no upload' });
        }

        const fileName = `${Date.now()}_${originalName}`;
        console.log('Nome final:', fileName);

        console.log('Iniciando upload para Supabase Storage...');
        const { error: uploadError } = await supabase.storage
            .from('documentos')
            .upload(fileName, fileBuffer, { contentType: 'application/pdf' });

        if (uploadError) {
            console.error('Erro Supabase storage:', JSON.stringify(uploadError));
            return res.status(500).json({ error: uploadError.message });
        }

        console.log('Upload no storage OK');

        const { data: publicUrlData } = supabase.storage
            .from('documentos')
            .getPublicUrl(fileName);

        console.log('Public URL:', publicUrlData.publicUrl);

        const { error: insertError } = await supabase.from('documents').insert({
            name: originalName,
            file_path: fileName,
            public_url: publicUrlData.publicUrl
        });

        if (insertError) {
            console.error('Erro ao inserir na tabela documents:', JSON.stringify(insertError));
            return res.status(500).json({ error: insertError.message });
        }

        console.log('Registro inserido na tabela OK');
        console.log('Disparando webhook n8n ingestao...');

        const webhookRes = await fetch(process.env.N8N_WEBHOOK_INGESTAO, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pdf_url: publicUrlData.publicUrl,
                document_id: fileName
            })
        });

        console.log('Webhook n8n status:', webhookRes.status);
        res.json({ success: true });

    } catch (err) {
        console.error('Erro geral no upload:', err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/documents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('Deletando documento id:', id);

        const { data: doc, error: selectError } = await supabase
            .from('documents')
            .select('file_path')
            .eq('id', id)
            .single();

        if (selectError) {
            console.error('Erro ao buscar documento:', selectError);
            return res.status(500).json({ error: selectError.message });
        }

        await supabase.storage.from('documentos').remove([doc.file_path]);
        await supabase.from('product_docs').delete().eq('document_id', doc.file_path);
        await supabase.from('documents').delete().eq('id', id);

        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao deletar:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/generate', async (req, res) => {
    try {
        console.log('--- INÍCIO DO GENERATE ---');
        const { query } = req.body;
        console.log('Query recebida:', query);
        console.log('Webhook busca URL:', process.env.N8N_WEBHOOK_BUSCA);

        const response = await fetch(process.env.N8N_WEBHOOK_BUSCA, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });

        console.log('Status do webhook busca:', response.status);
        const data = await response.json();
        console.log('Resposta do webhook:', JSON.stringify(data));
        res.json(data);
    } catch (err) {
        console.error('Erro no generate:', err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

module.exports = app;

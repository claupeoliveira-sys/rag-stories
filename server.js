require('dotenv').config();
const express = require('express');
const Busboy = require('busboy');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

app.use(express.json());

// Listar documentos
app.get('/api/documents', async (req, res) => {
    const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error });
    res.json(data);
});

// Upload de PDF usando Busboy
app.post('/api/upload', (req, res) => {
    const bb = Busboy({ headers: req.headers });
    let fileBuffer = [];
    let fileName = '';
    let originalName = '';

    bb.on('file', (name, file, info) => {
        originalName = info.filename;
        fileName = `${Date.now()}_${info.filename}`;
        file.on('data', (data) => fileBuffer.push(data));
    });

    bb.on('finish', async () => {
        const buffer = Buffer.concat(fileBuffer);

        const { error: uploadError } = await supabase.storage
            .from('documentos')
            .upload(fileName, buffer, { contentType: 'application/pdf' });

        if (uploadError) return res.status(500).json({ error: uploadError });

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
    });

    req.pipe(bb);
});

// Deletar documento
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

// Gerar histórias via RAG
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

async function carregarDocs() {
    const res = await fetch('/api/documents');
    const docs = await res.json();
    const lista = document.getElementById('listaDocs');
    const badge = document.getElementById('docCount');

    badge.textContent = docs.length;

    if (docs.length === 0) {
        lista.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📂</div>
                <p>Nenhum documento na base de conhecimento.</p>
            </div>`;
        return;
    }

    lista.innerHTML = docs.map(doc => `
        <div class="doc-item" id="doc-${doc.id}">
            <div class="doc-info">
                <div class="doc-icon">📄</div>
                <div>
                    <div class="doc-name" onclick="visualizar('${doc.public_url}', '${doc.name}')">${doc.name}</div>
                    <div class="doc-date">${new Date(doc.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                </div>
            </div>
            <div class="doc-actions">
                <button class="btn btn-outline" onclick="visualizar('${doc.public_url}', '${doc.name}')">👁 Ver</button>
                <button class="btn btn-danger" onclick="deletar('${doc.id}', '${doc.name}')">🗑 Excluir</button>
            </div>
        </div>
    `).join('');
}

function triggerUpload() {
    document.getElementById('inputFile').click();
}

async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    showToast(`Enviando ${file.name}...`);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (res.ok) {
        showToast('Documento adicionado e ingestão iniciada!');
        carregarDocs();
    } else {
        showToast('Erro ao enviar o arquivo.');
    }
    e.target.value = '';
}

async function deletar(id, nome) {
    if (!confirm(`Deseja excluir "${nome}"?`)) return;
    const res = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    if (res.ok) {
        showToast('Documento excluído.');
        carregarDocs();
        fecharVisualizador();
    }
}

function visualizar(url, nome) {
    document.getElementById('iframePDF').src = url;
    document.getElementById('viewerTitle').textContent = nome;
    document.getElementById('viewerWrapper').classList.add('open');
    document.getElementById('viewerWrapper').scrollIntoView({ behavior: 'smooth' });
}

function fecharVisualizador() {
    document.getElementById('viewerWrapper').classList.remove('open');
    document.getElementById('iframePDF').src = '';
}

async function gerarHistorias() {
    const query = document.getElementById('query').value.trim();
    if (!query) return showToast('Digite o que você está buscando.');

    const btn = document.getElementById('btnGerar');
    const loading = document.getElementById('loadingMsg');
    const resultSection = document.getElementById('resultSection');

    btn.disabled = true;
    loading.classList.add('visible');
    resultSection.classList.remove('visible');

    const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
    });

    const data = await res.json();
    const texto = data.text || data.content || data.output || JSON.stringify(data, null, 2);

    document.getElementById('resultado').value = texto;
    btn.disabled = false;
    loading.classList.remove('visible');
    resultSection.classList.add('visible');
    resultSection.scrollIntoView({ behavior: 'smooth' });
}

function baixarTxt() {
    const texto = document.getElementById('resultado').value;
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `historias-usuario-${Date.now()}.txt`;
    a.click();
    showToast('Download iniciado!');
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

carregarDocs();

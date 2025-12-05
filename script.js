// VARIÁVEIS GLOBAIS (Configuradas em index.html)
let currentCredential = null;
let currentIp = null;
let selectedFilial = null;
let allowedFiliais = [];
let lojas = [], docas = [], lideres = [], veiculos = [], motoristas = [];
let allExpeditions = [];
let filteredExpeditions = [];

// Variáveis globais (do index.html principal, mas agora referenciando o proxy)
const SUPABASE_PROXY_URL = '/api/proxy';
const headers = { 'Content-Type': 'application/json' }; // Headers simples para o proxy

// ====================================================================
// 1. FUNÇÃO CRÍTICA DE REQUISIÇÃO (USANDO O PROXY)
// ====================================================================
/**
 * Função unificada para requisições ao Supabase via proxy Vercel/similar.
 * Adaptação da versão TESTE para o contexto mobile.
 */
async function supabaseRequest(endpoint, method = 'GET', data = null, includeFilialFilter = true) {
    // Separa o endpoint base dos filtros existentes (se houver '?')
    const [nomeEndpointBase, filtrosExistentes] = endpoint.split('?', 2);
    
    // Constrói a URL começando com o proxy e o endpoint base
    let url = `${SUPABASE_PROXY_URL}?endpoint=${nomeEndpointBase}`; 
    
    // Adiciona filtros existentes se houver
    if (filtrosExistentes) {
        url += `&${filtrosExistentes}`;
    }
    
    // 🚨 REGRA DE FILTRO DE FILIAL EM GET (LEITURA) 🚨
    const tablesWithoutFilial = [
        'credenciais', // Credenciais não têm filtro de filial
        'filiais'      // Filiais não têm filtro de filial
    ];
    
    if (includeFilialFilter && selectedFilial && method === 'GET' && 
        !tablesWithoutFilial.includes(nomeEndpointBase)) {
        url += `&filial=eq.${selectedFilial.nome}`;
    }
    
    // Configura as opções da requisição
    const options = { 
        method, 
        headers: { 
            'Content-Type': 'application/json',
            // Adicionar header 'Accept' para receber JSON
            'Accept': 'application/json' 
        } 
    }; 
    
    // Processamento do Payload (para POST, PATCH, PUT)
    if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) { 
        let payload = data;
        const tablesWithTriggerFilial = ['expedition_items'];

        // Se for expedition_items, remove o campo filial (o trigger no banco cuida)
        if (nomeEndpointBase === 'expedition_items') {
            if (Array.isArray(payload)) {
                payload = payload.map(item => {
                    const cleanItem = {...item};
                    delete cleanItem.filial;
                    return cleanItem;
                });
            } else {
                payload = {...payload};
                delete payload.filial;
            }
        } 
        // Para outras tabelas que precisam de filial, injeta o valor
        else if (includeFilialFilter && selectedFilial && 
                 !tablesWithoutFilial.includes(nomeEndpointBase) && 
                 !tablesWithTriggerFilial.includes(nomeEndpointBase)) {
            if (Array.isArray(data)) {
                payload = data.map(item => ({ 
                    ...item, 
                    filial: selectedFilial.nome 
                }));
            } else {
                payload = { 
                    ...data, 
                    filial: selectedFilial.nome 
                }; 
            }
        }
        
        options.body = JSON.stringify(payload);
    } 
    
    // Configura header Prefer para retornar dados após operação
    if (method === 'PATCH' || method === 'POST') {
        options.headers.Prefer = 'return=representation';
    }
    
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            let errorText = await response.text();
            let errorMessage = `Erro ${response.status}: ${errorText}`;
            try {
                const errorJson = JSON.parse(errorText);
                errorMessage = `Erro ${response.status}: ${errorJson.message || errorJson.details || errorText}`;
            } catch (e) { /* ignore parse error */ }
            throw new Error(errorMessage);
        }
        return method === 'DELETE' || response.status === 204 ? null : await response.json();
    } catch (error) {
        console.error(`Erro na requisição: ${method} ${url}`, error);
        showNotification(`Erro de comunicação: ${error.message}`, 'error');
        throw error;
    }
}
// ====================================================================
// 2. LÓGICA DO APP (Refatorada)
// ====================================================================

// Verificar sessão salva
async function checkSavedSession() {
    const savedIp = localStorage.getItem('expeditionMobile_ip');
    const savedCredential = localStorage.getItem('expeditionMobile_credential');
    const savedFilial = localStorage.getItem('expeditionMobile_filial');
    
    if (savedIp && savedCredential) {
        try {
            currentIp = savedIp;
            showNotification('Verificando credenciais salvas...', 'info');
            
            // Validar credencial e IP salvos (USANDO O PROXY)
            const credentials = await supabaseRequest(
                `credenciais?codigo_credencial=eq.${savedCredential}&ip_address=eq.${savedIp}&ativo=eq.true`, 
                'GET', null, false
            );
            
            if (credentials && credentials.length > 0) {
                currentCredential = credentials[0];
                
                // Obter filiais permitidas (USANDO O PROXY)
                const allFiliais = await supabaseRequest('filiais?select=nome,descricao,ativo&ativo=eq.true&order=nome', 'GET', null, false);
                allowedFiliais = allFiliais.filter(filial => currentCredential.empresas_acesso.includes(filial.nome));
                
                if (allowedFiliais.length > 0) {
                    if (savedFilial && allowedFiliais.find(f => f.nome === savedFilial)) {
                        const filial = allowedFiliais.find(f => f.nome === savedFilial);
                        await selectFilial(filial, true);
                        return;
                    } 
                    else if (allowedFiliais.length === 1) {
                        await selectFilial(allowedFiliais[0], true);
                        return;
                    } 
                    else {
                        showFilialSelection();
                        return;
                    }
                }
            }
        } catch (error) {
            clearSavedSession();
        }
    }
    
    checkSavedIp();
}

// Verificar IP salvo no localStorage  
function checkSavedIp() {
    const savedIp = localStorage.getItem('expeditionMobile_ip');
    
    if (savedIp) {
        currentIp = savedIp;
        document.getElementById('savedIpInfo').style.display = 'flex';
        document.getElementById('savedIpText').textContent = `IP: ${savedIp}`;
        document.getElementById('ipFieldContainer').style.display = 'none';
        document.getElementById('ipInput').required = false;
    } else {
        document.getElementById('savedIpInfo').style.display = 'none';
        document.getElementById('ipFieldContainer').style.display = 'block';
        document.getElementById('ipInput').required = true;
    }
}

// Limpar sessão salva
function clearSavedSession() {
    localStorage.removeItem('expeditionMobile_credential');
    localStorage.removeItem('expeditionMobile_filial');
    currentCredential = null;
    selectedFilial = null;
    allowedFiliais = [];
}

// Alterar IP
function changeIp() {
    if (confirm('Deseja alterar o endereço IP? Você precisará digitar um novo IP válido.')) {
        localStorage.removeItem('expeditionMobile_ip');
        currentIp = null;
        document.getElementById('ipInput').value = '';
        checkSavedIp();
    }
}

// Login
async function handleLogin(e) {
    e.preventDefault();
    
    const credential = document.getElementById('credentialInput').value.trim();
    const ipInput = document.getElementById('ipInput').value.trim();
    const loginBtn = document.getElementById('loginBtn');
    
    if (!credential) {
        showNotification('Digite uma credencial válida!', 'error');
        return;
    }

    const ipToValidate = currentIp || ipInput;
    
    if (!ipToValidate || (!currentIp && !validateIpFormat(ipToValidate))) {
        showNotification(currentIp ? 'IP de sessão inválido' : 'Formato de IP inválido! Use o formato: 192.168.1.100', 'error');
        return;
    }

    try {
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<div class="spinner" style="width: 20px; height: 20px; margin: 0 auto;"></div>';

        // Verificar credencial e IP (USANDO O PROXY)
        const credentials = await supabaseRequest(
            `credenciais?codigo_credencial=eq.${credential}&ip_address=eq.${ipToValidate}&ativo=eq.true`, 
            'GET', null, false
        );
        
        if (!credentials || credentials.length === 0) {
            throw new Error('Credencial ou IP inválido, ou acesso inativo');
        }

        currentCredential = credentials[0];
        
        if (!currentIp) {
            currentIp = ipToValidate;
            localStorage.setItem('expeditionMobile_ip', currentIp);
        }
        
        localStorage.setItem('expeditionMobile_credential', credential);
        
        if (!currentCredential.empresas_acesso || currentCredential.empresas_acesso.length === 0) {
            throw new Error('Credencial sem acesso a filiais');
        }

        // Obter filiais permitidas (USANDO O PROXY)
        const allFiliais = await supabaseRequest('filiais?select=nome,descricao,ativo&ativo=eq.true&order=nome', 'GET', null, false);
        allowedFiliais = allFiliais.filter(filial => currentCredential.empresas_acesso.includes(filial.nome));
        
        if (allowedFiliais.length === 0) {
            throw new Error('Nenhuma filial disponível para esta credencial');
        }

        showNotification('Acesso autorizado!', 'success');
        
        if (allowedFiliais.length === 1) {
            await selectFilial(allowedFiliais[0]);
        } else {
            showFilialSelection();
        }

    } catch (error) {
        console.error('Erro no login:', error);
        showNotification(error.message, 'error');
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i data-feather="log-in" class="w-4 h-4" style="display: inline; margin-right: 8px;"></i>Entrar';
        feather.replace();
    }
}

// Validar formato de IP
function validateIpFormat(ip) {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    return ipRegex.test(ip);
}

// Mostrar seleção de filiais
function showFilialSelection() {
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('filialSelectionContainer').style.display = 'block';
    renderFiliais(allowedFiliais);
}

function renderFiliais(filiais) {
    const grid = document.getElementById('filiaisGrid');
    grid.innerHTML = '';
    
    filiais.forEach(filial => {
        const card = document.createElement('div');
        card.className = 'filial-card';
        card.onclick = () => selectFilial(filial);
        card.innerHTML = `
            <h3>${filial.nome}</h3>
            <p>${filial.descricao || 'Filial'}</p>
        `;
        grid.appendChild(card);
    });
}

// Selecionar filial
async function selectFilial(filial, isAutoLogin = false) {
    selectedFilial = filial;
    document.getElementById('headerFilial').textContent = `Filial: ${selectedFilial.nome}`;
    
    const trocarBtn = document.getElementById('trocarFilialBtn');
    if (allowedFiliais.length > 1) {
        trocarBtn.style.display = 'inline-block';
    } else {
        trocarBtn.style.display = 'none';
    }
    
    localStorage.setItem('expeditionMobile_filial', selectedFilial.nome);
    
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('filialSelectionContainer').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    
    if (isAutoLogin) {
        showNotification(`Bem-vindo de volta! Filial: ${selectedFilial.nome}`, 'success');
    } else {
        showNotification(`Filial ${selectedFilial.nome} selecionada!`, 'success');
    }
    
    await loadAppData();
}

// Trocar filial rapidamente (função do botão no header)
function trocarFilialRapido() {
    if (allowedFiliais.length > 1) {
        selectedFilial = null;
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('filialSelectionContainer').style.display = 'block';
        renderFiliais(allowedFiliais);
        showNotification('Selecione uma nova filial', 'info');
    }
}

// Logout
function logout() {
    if (confirm('Deseja realmente sair?')) {
        clearSavedSession();
        
        document.getElementById('loginForm').reset();
        document.getElementById('expeditionForm').reset();
        
        checkSavedIp();
        
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('filialSelectionContainer').style.display = 'none';
        document.getElementById('loginContainer').style.display = 'block';
        
        showNotification('Você foi desconectado', 'info');
    }
}

// Carregar dados do app
async function loadAppData() {
    try {
        // Uso do proxy e filtro de filial implícito no GET
        const [lojasData, docasData, lideresData, veiculosData, motoristasData] = await Promise.all([
            supabaseRequest('lojas?select=*&ativo=eq.true&order=codigo,nome'),
            supabaseRequest('docas?ativo=eq.true&order=nome'),
            supabaseRequest('lideres?ativo=eq.true&order=nome'),
            supabaseRequest('veiculos?order=placa'),
            supabaseRequest('motoristas?order=nome')
        ]);
        
        lojas = lojasData || [];
        docas = docasData || [];
        lideres = lideresData || [];
        veiculos = veiculosData || [];
        motoristas = motoristasData || [];
        
        populateSelects();
        
        const hoje = new Date().toISOString().split('T')[0];
        const filtroData = document.getElementById('filtroData');
        if (filtroData) {
            filtroData.value = hoje;
        }
        
        loadExpeditions();
        
    } catch (error) {
        showNotification('Erro ao carregar dados do sistema.', 'error');
    }
}

// Preencher selects
function populateSelects() {
    const lojaSelect = document.getElementById('lojaSelect');
    lojaSelect.innerHTML = '<option value="">Selecione a loja</option>';
    const lojasOrdenadas = [...lojas].sort((a, b) => {
        const codigoCompare = (a.codigo || '').localeCompare(b.codigo || '', 'pt-BR', { numeric: true });
        if (codigoCompare !== 0) return codigoCompare;
        return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    });
    lojasOrdenadas.forEach(loja => {
        lojaSelect.innerHTML += `<option value="${loja.id}">${loja.codigo} - ${loja.nome}</option>`;
    });

    const docaSelect = document.getElementById('docaSelect');
    docaSelect.innerHTML = '<option value="">Selecione a doca</option>';
    const docasOrdenadas = [...docas].sort((a, b) => {
        return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    });
    docasOrdenadas.forEach(doca => {
        docaSelect.innerHTML += `<option value="${doca.id}">${doca.nome}</option>`;
    });

    const conferenteSelect = document.getElementById('conferenteSelect');
    conferenteSelect.innerHTML = '<option value="">Selecione o conferente</option>';
    const lideresOrdenados = [...lideres].sort((a, b) => {
        return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    });
    lideresOrdenados.forEach(lider => {
        conferenteSelect.innerHTML += `<option value="${lider.id}">${lider.nome}</option>`;
    });
}

// Lançar expedição
async function handleLancarExpedicao(e) {
    e.preventDefault();
    
    const lojaId = document.getElementById('lojaSelect').value;
    const docaId = document.getElementById('docaSelect').value;
    const liderId = document.getElementById('conferenteSelect').value;
    const numerosCargaInput = document.getElementById('numerosCargaInput').value.trim();
    const pallets = parseInt(document.getElementById('palletsInput').value) || 0;
    const rolltrainers = parseInt(document.getElementById('rollTainersInput').value) || 0;
    const observacoes = document.getElementById('observacoes').value.trim();

    if (!lojaId || !docaId || !liderId || (pallets === 0 && rolltrainers === 0)) {
        showNotification('Preencha todos os campos obrigatórios!', 'error');
        return;
    }

    try {
        let numerosCarga = [];
        if (numerosCargaInput) {
            numerosCarga = numerosCargaInput.split(',').map(num => num.trim()).filter(num => num.length > 0);
        }

        const expeditionData = {
            data_hora: new Date().toISOString(),
            lider_id: liderId,
            doca_id: docaId,
            status: 'aguardando_agrupamento',
            observacoes: observacoes || null,
            numeros_carga: numerosCarga.length > 0 ? numerosCarga : null
        };
        
        // Uso do proxy e filtro de filial (true)
        const expeditionResponse = await supabaseRequest('expeditions', 'POST', expeditionData, true);
        
        if (!expeditionResponse || expeditionResponse.length === 0) {
            throw new Error("Falha ao criar expedição");
        }
        
        const newExpeditionId = expeditionResponse[0].id;

        const itemData = {
            expedition_id: newExpeditionId,
            loja_id: lojaId,
            pallets: pallets,
            rolltrainers: rolltrainers,
            status_descarga: 'pendente'
        };
        
        // Uso do proxy, sem filtro de filial no payload (false, mas a função ajusta para expedition_items)
        await supabaseRequest('expedition_items', 'POST', itemData, false);

        const lojaNome = lojas.find(l => l.id === lojaId)?.nome || 'Loja';
        showNotification(`Expedição para ${lojaNome} lançada com sucesso!`, 'success');

        document.getElementById('expeditionForm').reset();
        
        if (document.getElementById('acompanhamento').classList.contains('active')) {
            loadExpeditions();
        }

    } catch (error) {
        console.error('Erro ao lançar expedição:', error);
        showNotification(`Erro ao lançar expedição: ${error.message}`, 'error');
    }
}

// Carregar expedições
async function loadExpeditions() {
    try {
        const filtroData = document.getElementById('filtroData')?.value;
        const dataConsulta = filtroData || new Date().toISOString().split('T')[0];
        
        // Uso do proxy e filtro de filial implícito no GET
        const expeditions = await supabaseRequest(`expeditions?data_hora=gte.${dataConsulta}T00:00:00&data_hora=lte.${dataConsulta}T23:59:59&order=data_hora.desc`);
        
        const items = await supabaseRequest('expedition_items'); 
        
        // Lógica de combinação de dados
        allExpeditions = expeditions.map(exp => {
            const expItems = items.filter(item => item.expedition_id === exp.id);
            
            let expeditionInfo = {};
            if (expItems.length === 1) {
                const loja = lojas.find(l => l.id === expItems[0].loja_id);
                expeditionInfo = { tipo: 'individual', loja_nome: loja ? `${loja.codigo} - ${loja.nome}` : 'N/A', total_lojas: 1 };
            } else if (expItems.length > 1) {
                const lojasNomes = expItems.map(item => {
                    const loja = lojas.find(l => l.id === item.loja_id);
                    return loja ? `${loja.codigo}` : 'N/A';
                }).join(', ');
                expeditionInfo = { tipo: 'agrupada', loja_nome: `${expItems.length} lojas: ${lojasNomes}`, total_lojas: expItems.length };
            } else {
                expeditionInfo = { tipo: 'vazia', loja_nome: 'Sem itens', total_lojas: 0 };
            }
            
            const lider = lideres.find(l => l.id === exp.lider_id);
            const doca = docas.find(d => d.id === exp.doca_id);
            
            return {
                ...exp,
                ...expeditionInfo,
                items: expItems,
                lider_nome: lider ? lider.nome : 'N/A',
                doca_nome: doca ? doca.nome : 'N/A',
                total_pallets: expItems.reduce((sum, item) => sum + (item.pallets || 0), 0),
                total_rolltrainers: expItems.reduce((sum, item) => sum + (item.rolltrainers || 0), 0)
            };
        });

        if (document.getElementById('filtroStatus').children.length <= 1) {
            populateStatusFilter();
        }

        applyFilters();

    } catch (error) {
        document.getElementById('expeditionsList').innerHTML = '<p class="text-center text-red-500">Erro ao carregar expedições</p>';
    }
}

function populateStatusFilter() {
    const filtroStatus = document.getElementById('filtroStatus');
    if (!filtroStatus) return;

    const statuses = [...new Set(allExpeditions.map(e => e.status))];
    
    const currentValue = filtroStatus.value;
    filtroStatus.innerHTML = '<option value="">Todos</option>';
    
    statuses.forEach(status => {
        filtroStatus.innerHTML += `<option value="${status}">${getStatusLabel(status)}</option>`;
    });
    
    if (currentValue) {
        filtroStatus.value = currentValue;
    }
}

function applyFilters() {
    const filtroStatus = document.getElementById('filtroStatus')?.value || '';
    const filtroBusca = document.getElementById('filtroBusca')?.value.toLowerCase() || '';
    
    filteredExpeditions = allExpeditions.filter(exp => {
        if (filtroStatus && exp.status !== filtroStatus) {
            return false;
        }
        
        if (filtroBusca) {
            const searchableText = [
                exp.loja_nome,
                exp.lider_nome,
                exp.doca_nome,
                exp.observacoes || '',
                exp.numeros_carga ? (Array.isArray(exp.numeros_carga) ? exp.numeros_carga.join(' ') : String(exp.numeros_carga)) : ''
            ].join(' ').toLowerCase();
            
            if (!searchableText.includes(filtroBusca)) {
                return false;
            }
        }
        
        return true;
    });

    highlightActiveFilters();
    updateStats();
    renderExpeditions();
}

function clearFilters() {
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('filtroData').value = hoje;
    document.getElementById('filtroStatus').value = '';
    document.getElementById('filtroBusca').value = '';
    
    loadExpeditions();
}

function refreshExpeditions() {
    const refreshBtn = document.querySelector('[onclick="refreshExpeditions()"]');
    const refreshIcon = refreshBtn?.querySelector('i');
    
    if (refreshIcon) {
        refreshIcon.classList.add('spinning');
    }
    
    showNotification('Atualizando expedições...', 'info');
    
    loadExpeditions().finally(() => {
        if (refreshIcon) {
            refreshIcon.classList.remove('spinning');
        }
    });
}

function highlightActiveFilters() {
    const filtroStatus = document.getElementById('filtroStatus');
    const filtroBusca = document.getElementById('filtroBusca');
    const filtroData = document.getElementById('filtroData');
    const hoje = new Date().toISOString().split('T')[0];
    
    if (filtroStatus?.value) {
        filtroStatus.classList.add('filter-active');
    } else {
        filtroStatus?.classList.remove('filter-active');
    }
    
    if (filtroBusca?.value) {
        filtroBusca.classList.add('filter-active');
    } else {
        filtroBusca?.classList.remove('filter-active');
    }
    
    if (filtroData?.value && filtroData.value !== hoje) {
        filtroData.classList.add('filter-active');
    } else {
        filtroData?.classList.remove('filter-active');
    }
}

function updateStats() {
    const expeditionsToCount = filteredExpeditions.length > 0 ? filteredExpeditions : allExpeditions;
    
    const total = expeditionsToCount.length;
    const pendentes = expeditionsToCount.filter(e => ['aguardando_agrupamento', 'aguardando_veiculo'].includes(e.status)).length;
    const emAndamento = expeditionsToCount.filter(e => ['em_carregamento', 'carregado', 'saiu_para_entrega'].includes(e.status)).length;
    const concluidas = expeditionsToCount.filter(e => e.status === 'entregue').length;

    document.getElementById('totalExpedicoes').textContent = total;
    document.getElementById('pendentesCount').textContent = pendentes;
    document.getElementById('emAndamentoCount').textContent = emAndamento;
    document.getElementById('concluidasCount').textContent = concluidas;
}

function renderExpeditions() {
    const container = document.getElementById('expeditionsList');
    const expeditionsToRender = filteredExpeditions.length > 0 || (document.getElementById('filtroStatus')?.value || document.getElementById('filtroBusca')?.value) ? filteredExpeditions : allExpeditions;
    
    if (expeditionsToRender.length === 0) {
        const hasFilters = document.getElementById('filtroStatus')?.value || document.getElementById('filtroBusca')?.value;
        const message = hasFilters ? 'Nenhuma expedição encontrada para os filtros aplicados' : 'Nenhuma expedição encontrada para esta data';
        container.innerHTML = `<p class="text-center text-gray-500">${message}</p>`;
        return;
    }

    container.innerHTML = expeditionsToRender.map(exp => {
        const docaInfo = docas.find(d => d.id === exp.doca_id)?.nome || 'N/A';
        
        let veiculoInfo = '';
        if (exp.veiculo_id && exp.motorista_id) {
            const placaVeiculo = veiculos.find(v => v.id === exp.veiculo_id)?.placa || 'N/A';
            const nomeMotorista = motoristas.find(m => m.id === exp.motorista_id)?.nome || 'N/A';
            veiculoInfo = `<br><strong>🚚 ${placaVeiculo}</strong> - ${nomeMotorista}`;
        } else if (exp.veiculo_id || exp.motorista_id) {
            veiculoInfo = `<br><strong>🚛 Transporte:</strong> Em alocação...`;
        }
        
        let ordemInfo = '';
        if (exp.tipo === 'individual') {
            ordemInfo = `<br><strong>📍 Ordem:</strong> Entrega única`;
        } else if (exp.tipo === 'agrupada') {
            const lojasOrdem = exp.items
                .sort((a, b) => (a.ordem_entrega || 999) - (b.ordem_entrega || 999))
                .map((item, index) => {
                    const loja = lojas.find(l => l.id === item.loja_id);
                    const statusIcon = getStatusIcon(item.status_descarga || 'pendente');
                    const ordemReal = item.ordem_entrega || (index + 1);
                    return `${statusIcon}${ordemReal}º ${loja ? loja.codigo : 'N/A'}`;
                }).join(' → ');
            ordemInfo = `<br><strong>📍 Roteiro:</strong> ${lojasOrdem}`;
        }
        
        let tipoBadge = exp.tipo === 'agrupada' ? `<span class="type-badge">ROTA</span>` : '';

        let urgencyBadge = '';
        const horasDecorridas = (new Date() - new Date(exp.data_hora)) / (1000 * 60 * 60);
        if (horasDecorridas > 8 && !['entregue', 'cancelado'].includes(exp.status)) {
            urgencyBadge = `<span class="urgency-badge urgency-8h">⏰ +8h</span>`;
        } else if (horasDecorridas > 4 && !['entregue', 'cancelado'].includes(exp.status)) {
            urgencyBadge = `<span class="urgency-badge urgency-4h">⏰ +4h</span>`;
        }

        // LÓGICA DE EXIBIÇÃO DA CARGA MAIS ROBUSTA
        let cargas = [];
        if (Array.isArray(exp.numeros_carga)) {
            cargas = exp.numeros_carga;
        } else if (typeof exp.numeros_carga === 'string') {
             // Caso venha como string (ex: "123, 456" ou "{123,456}" formato Postgres array as string)
             // Remove chaves e aspas que possam vir do banco
             const clean = exp.numeros_carga.replace(/[{}"]/g, '');
             if (clean) {
                 cargas = clean.split(',').map(s => s.trim()).filter(s => s);
             }
        }
        
        // Remove itens vazios
        cargas = cargas.filter(c => c && c.toString().trim() !== '');

        const numerosCargaBadge = cargas.length > 0
            ? `<div class="carga-badge">
                <i data-feather="package" style="width: 14px; height: 14px; margin-top: 2px;"></i>
                <span><strong>Cargas:</strong> ${cargas.join(', ')}</span>
               </div>`
            : '';

        return `
            <div class="expedition-item">
                <div class="expedition-header">
                    <div>
                        <div class="expedition-title">
                            ${exp.loja_nome}${tipoBadge}${urgencyBadge}
                        </div>
                        <div class="expedition-time">${new Date(exp.data_hora).toLocaleString('pt-BR')}</div>
                    </div>
                    <span class="status-badge status-${exp.status}">${getStatusLabel(exp.status)}</span>
                </div>
                <div class="expedition-details">
                    <strong>⚓ Doca:</strong> ${docaInfo}${ordemInfo}<br>
                    <strong>👤 Conferente:</strong> ${exp.lider_nome}<br>
                    <strong>📦 Carga:</strong> ${exp.total_pallets}P + ${exp.total_rolltrainers}R${veiculoInfo}
                    ${exp.observacoes ? `<br><strong>💬 Obs:</strong> ${exp.observacoes}` : ''}
                    ${numerosCargaBadge}
                </div>
            </div>
        `;
    }).join('');
    
    // Reaplica os ícones
    feather.replace();
}

function getStatusIcon(statusDescarga) {
    const icons = {
        'pendente': '⏳',
        'em_descarga': '🚚',
        'descarregado': '✅',
        'cancelado': '❌'
    };
    return icons[statusDescarga] || '⏳';
}

function getStatusLabel(status) {
    const labels = {
        'pendente': 'Pendente',
        'aguardando_agrupamento': 'Aguard. Agrupamento',
        'aguardando_doca': 'Aguard. Doca',
        'aguardando_veiculo': 'Aguard. Veículo',
        'em_carregamento': 'Carregando',
        'carregado': 'Carregado',
        'aguardando_faturamento': 'Aguard. Faturamento',
        'faturamento_iniciado': 'Faturando',
        'faturado': 'Faturado',
        'saiu_para_entrega': 'Em Entrega',
        'entregue': 'Entregue',
        'retornando_cd': 'Retornando',
        'cancelado': 'Cancelado'
    };
    return labels[status] || status.replace(/_/g, ' ');
}

function showView(viewId, element) {
    document.querySelectorAll('.view-content').forEach(view => {
        view.classList.remove('active');
    });
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    document.getElementById(viewId).classList.add('active');
    if (element) element.classList.add('active');

    if (viewId === 'acompanhamento') {
        loadExpeditions();
    }

    feather.replace();
}

function showConfigOptions() {
    const options = [
        '1. Alterar IP',
        '2. Logout Completo (limpa tudo)',
        '3. Cancelar'
    ];
    
    const choice = prompt(`Configurações disponíveis:\n\n${options.join('\n')}\n\nDigite o número da opção:`);
    
    if (choice === '1') {
        alterarIpConfig();
    } else if (choice === '2') {
        logoutCompleto();
    }
}

function logoutCompleto() {
    if (confirm('Deseja fazer logout completo? Isso removerá todas as informações salvas (credencial, IP e filial).')) {
        localStorage.removeItem('expeditionMobile_ip');
        localStorage.removeItem('expeditionMobile_credential');
        localStorage.removeItem('expeditionMobile_filial');
        
        currentIp = null;
        currentCredential = null;
        selectedFilial = null;
        allowedFiliais = [];
        
        document.getElementById('loginForm').reset();
        document.getElementById('expeditionForm').reset();
        
        checkSavedIp();
        
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('filialSelectionContainer').style.display = 'none';
        document.getElementById('loginContainer').style.display = 'block';
        
        showNotification('Todos os dados foram removidos. Digite credencial e IP novamente.', 'info');
    }
}

function alterarIpConfig() {
    if (confirm('Deseja alterar o endereço IP? Você será desconectado e precisará fazer login novamente.')) {
        localStorage.removeItem('expeditionMobile_ip');
        currentIp = null;
        
        currentCredential = null;
        selectedFilial = null;
        allowedFiliais = [];
        
        document.getElementById('loginForm').reset();
        document.getElementById('expeditionForm').reset();
        
        checkSavedIp();
        
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('filialSelectionContainer').style.display = 'none';
        document.getElementById('loginContainer').style.display = 'block';
        
        showNotification('IP removido. Digite o novo IP para continuar.', 'info');
    }
}

function showNotification(message, type = 'success') {
    const existing = document.getElementById('currentNotification');
    if (existing) {
        existing.remove();
    }

    const notification = document.createElement('div');
    notification.id = 'currentNotification';
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.getElementById('notificationContainer').appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 100);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// Inicialização
document.addEventListener('DOMContentLoaded', async () => {
    feather.replace();
    
    await checkSavedSession();
    
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('expeditionForm').addEventListener('submit', handleLancarExpedicao);
});

setInterval(() => {
    if (document.getElementById('acompanhamento').classList.contains('active') && selectedFilial) {
        loadExpeditions();
    }
}, 60000);

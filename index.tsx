
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// --- Types ---
interface Client {
  id: string;
  name: string;
  apiKey: string; 
  tokensUsed: number;
  limit: number;
  lastUsed: string;
}

interface UsageLog {
  id: string;
  clientId: string;
  clientName: string;
  tokens: number;
  timestamp: string;
  timestampIso: string;
}

// --- Security Utilities ---
const SALT = 'gemini-dashboard-v2';
function encrypt(text: string): string {
  return btoa(text.split('').map((char, i) => 
    String.fromCharCode(char.charCodeAt(0) ^ SALT.charCodeAt(i % SALT.length))
  ).join(''));
}

function decrypt(encoded: string): string {
  try {
    const decoded = atob(encoded);
    return decoded.split('').map((char, i) => 
      String.fromCharCode(char.charCodeAt(0) ^ SALT.charCodeAt(i % SALT.length))
    ).join('');
  } catch {
    return 'Erro ao descriptografar';
  }
}

// --- State Management ---
const API_KEY = process.env.API_KEY;
const ai = new GoogleGenAI({ apiKey: API_KEY });

let clients: Client[] = [];
let usageLogs: UsageLog[] = [];
let filterStartDate: string = '';
let filterEndDate: string = '';
let aiResponse: string = '';

// Initial Load
const rawStorage = localStorage.getItem('api_clients_v4');
if (rawStorage) {
  try {
    const decrypted = JSON.parse(decrypt(rawStorage));
    clients = decrypted.clients || [];
    usageLogs = decrypted.logs || [];
  } catch (e) {
    console.error("Falha ao carregar dados:", e);
  }
}

let activeView: 'dashboard' | 'simulator' = 'dashboard';
let isModalOpen = false;
let visibleKeys: Set<string> = new Set();
let usageChart: Chart | null = null;

// --- Function Declarations ---
const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'cadastrar_cliente',
    parameters: {
      type: Type.OBJECT,
      description: 'Cadastra um novo cliente no sistema de API.',
      properties: {
        nome: { type: Type.STRING, description: 'Nome da empresa ou cliente.' },
        limite: { type: Type.NUMBER, description: 'Limite mensal de tokens.' }
      },
      required: ['nome']
    }
  },
  {
    name: 'remover_cliente',
    parameters: {
      type: Type.OBJECT,
      description: 'Remove um cliente existente buscando pelo nome.',
      properties: { nome: { type: Type.STRING } },
      required: ['nome']
    }
  },
  {
    name: 'limpar_historico',
    parameters: { type: Type.OBJECT, properties: {} }
  }
];

// --- Icons ---
const Icons = {
  Dashboard: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
  Simulator: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path></svg>`,
  Plus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  Trash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>`
};

// --- Logic ---
function saveData() {
  const data = { clients, logs: usageLogs };
  localStorage.setItem('api_clients_v4', encrypt(JSON.stringify(data)));
  render();
}

async function runAICommand(prompt: string) {
  const statusEl = document.getElementById('status-text');
  if (statusEl) statusEl.textContent = 'Processando solicitação...';
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: { tools: [{ functionDeclarations: toolDeclarations }] }
    });

    const calls = response.functionCalls;
    if (calls?.length) {
      for (const call of calls) {
        if (call.name === 'cadastrar_cliente') {
          const { nome, limite } = call.args as any;
          clients.push({ id: crypto.randomUUID(), name: nome, apiKey: encrypt('IA_KEY'), tokensUsed: 0, limit: limite || 100000, lastUsed: 'IA' });
          aiResponse = `✨ Cliente **${nome}** foi cadastrado com sucesso!`;
        } else if (call.name === 'remover_cliente') {
          const { nome } = call.args as any;
          const initialLength = clients.length;
          clients = clients.filter(c => c.name.toLowerCase() !== nome.toLowerCase());
          if (clients.length < initialLength) {
             aiResponse = `🗑️ Cliente **${nome}** removido do sistema.`;
          } else {
             aiResponse = `⚠️ Não encontrei o cliente **${nome}**.`;
          }
        } else if (call.name === 'limpar_historico') {
          usageLogs = [];
          aiResponse = `🧹 Todo o histórico de logs foi apagado.`;
        }
      }
    } else {
      aiResponse = response.text || "Comando processado com sucesso.";
    }
    saveData();
  } catch (e) {
    aiResponse = "❌ Ocorreu um erro ao processar seu pedido.";
    render();
  }
}

// --- Render ---
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="dashboard-layout">
      <aside class="sidebar">
        <div class="logo">
          <div class="logo-icon">✨</div>
          Nova<span>API</span>
        </div>
        <nav class="nav-group">
          <button class="nav-item ${activeView === 'dashboard' ? 'active' : ''}" id="nav-dashboard">
            ${Icons.Dashboard} Painel Geral
          </button>
          <button class="nav-item ${activeView === 'simulator' ? 'active' : ''}" id="nav-simulator">
            ${Icons.Simulator} Simulador IA
          </button>
        </nav>
      </aside>

      <main class="main-content">
        ${activeView === 'dashboard' ? renderDashboard() : renderSimulator()}
      </main>
    </div>
    ${isModalOpen ? renderModal() : ''}
  `;

  setupEvents();
  if (activeView === 'dashboard' && clients.length > 0) initChart();
}

function renderDashboard() {
  const totalTokens = clients.reduce((s, c) => s + c.tokensUsed, 0);
  const filteredLogs = usageLogs.filter(l => {
    if (!filterStartDate) return true;
    return new Date(l.timestampIso) >= new Date(filterStartDate);
  });

  return `
    <header class="content-header">
      <div>
        <p class="stat-label">Painel Administrativo</p>
        <h2>Visão Geral</h2>
      </div>
      <button class="btn-primary" id="btn-open-modal">${Icons.Plus} Novo Cliente</button>
    </header>

    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Clientes Ativos</span>
        <span class="stat-value">${clients.length}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Consumo Total</span>
        <span class="stat-value">${totalTokens.toLocaleString()} <small style="font-size: 1rem; opacity: 0.5;">tkn</small></span>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="main-column">
        <div class="stat-card chart-section">
          <span class="stat-label">Cota Utilizada</span>
          <div style="height: 300px;"><canvas id="usage-chart-canvas"></canvas></div>
        </div>

        <div class="table-container">
          <div class="table-header">Gerenciamento de Chaves</div>
          <table>
            <thead>
              <tr><th>Cliente</th><th>Chave API</th><th>Consumo</th><th style="text-align: right;">Ações</th></tr>
            </thead>
            <tbody>
              ${clients.map(c => `
                <tr>
                  <td><strong>${c.name}</strong></td>
                  <td><code>${visibleKeys.has(c.id) ? decrypt(c.apiKey) : '••••••••'}</code></td>
                  <td>
                    <div style="width: 100px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-bottom: 4px;">
                      <div style="width: ${Math.min((c.tokensUsed/c.limit)*100, 100)}%; height: 100%; background: var(--primary);"></div>
                    </div>
                    <small>${c.tokensUsed.toLocaleString()} / ${c.limit.toLocaleString()}</small>
                  </td>
                  <td style="text-align: right;">
                    <button class="btn-icon delete" data-id="${c.id}" title="Excluir">${Icons.Trash}</button>
                  </td>
                </tr>
              `).join('')}
              ${clients.length === 0 ? '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary); padding: 2rem;">Nenhum cliente cadastrado.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>

      <div class="side-column">
        <div class="stat-card history-card">
          <span class="stat-label">Histórico Recente</span>
          <div style="margin: 1rem 0;">
            <input type="date" id="filter-start" value="${filterStartDate}" style="width: 100%; padding: 8px; border-radius: 8px; border: 1px solid var(--border);">
          </div>
          <div class="logs-list">
            ${filteredLogs.slice(0, 10).map(l => `
              <div class="log-item">
                <div style="font-weight: 700; font-size: 0.85rem;">${l.clientName}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                  <span style="font-size: 0.75rem; color: var(--text-secondary);">${l.timestamp}</span>
                  <span style="color: #10b981; font-weight: 800;">+${l.tokens}</span>
                </div>
              </div>
            `).join('')}
            ${filteredLogs.length === 0 ? '<div style="text-align:center; padding: 1rem; color: var(--text-secondary); font-size: 0.9rem;">Sem registros recentes.</div>' : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSimulator() {
  return `
    <header class="content-header">
      <div>
        <p class="stat-label">Inteligência Artificial</p>
        <h2>Assistente de Fluxo</h2>
      </div>
    </header>
    <div class="simulator-grid" style="display: grid; grid-template-columns: 1fr 300px; gap: 2rem;">
      <div>
        <div style="margin-bottom: 1.5rem;">
          <label class="stat-label">Comando ou Texto para Análise</label>
          <textarea id="input-text" placeholder="Digite um comando para a IA ou cole um texto para contar tokens..."></textarea>
          
          <div class="suggestions-box" style="margin-top: 1rem;">
            <small class="stat-label" style="display:block; margin-bottom:0.5rem; color: var(--primary);">Sugestões Rápidas</small>
            <div class="chips-container">
              <button class="suggestion-chip" data-text="Cadastre a empresa TechSolar com limite de 500.000 tokens">Cadastrar Cliente</button>
              <button class="suggestion-chip" data-text="Remova o cliente TechSolar">Remover Cliente</button>
              <button class="suggestion-chip" data-text="Limpar todo o histórico de logs">Limpar Histórico</button>
              <button class="suggestion-chip" data-text="Quantos tokens tem neste texto?">Contar Tokens</button>
            </div>
          </div>

        </div>
        ${aiResponse ? `<div class="ai-bubble">${aiResponse}</div>` : ''}
        <div style="display: flex; gap: 12px; align-items: center; margin-top: 1.5rem;">
          <button class="btn-ai" id="btn-ai-process">Processar com IA ✨</button>
          <span id="status-text" style="font-size: 0.85rem; color: var(--text-secondary);">Pronto</span>
        </div>
      </div>
      <div>
        <div class="stat-card">
          <span class="stat-label">Resultado da Análise</span>
          <div style="margin-top: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
            <div><small class="stat-label">Tokens Estimados</small><div style="font-size: 2rem; font-weight: 800;" id="token-count">0</div></div>
            <div><small class="stat-label">Caracteres</small><div style="font-size: 1.25rem; font-weight: 700;" id="char-count">0</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderModal() {
  return `
    <div class="modal-overlay">
      <div class="modal-content">
        <h3 style="margin-top:0;">Novo Cliente</h3>
        <input type="text" id="modal-name" placeholder="Nome da Empresa/Cliente" style="width: 100%; padding: 12px; margin: 10px 0; border-radius: 8px; border: 1px solid var(--border);">
        <input type="number" id="modal-limit" value="100000" placeholder="Limite de Tokens" style="width: 100%; padding: 12px; margin: 10px 0; border-radius: 8px; border: 1px solid var(--border);">
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button class="btn-secondary" onclick="isModalOpen=false; render();" style="border: none; background: none; cursor: pointer; font-weight: 600; color: var(--text-secondary);">Cancelar</button>
          <button class="btn-primary" id="btn-save-client">Criar Cliente</button>
        </div>
      </div>
    </div>
  `;
}

function initChart() {
  const ctx = document.getElementById('usage-chart-canvas') as HTMLCanvasElement;
  if (!ctx) return;
  if (usageChart) usageChart.destroy();
  usageChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: clients.map(c => c.name),
      datasets: [{
        label: 'Consumo Atual',
        data: clients.map(c => c.tokensUsed),
        backgroundColor: '#6366f1',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
    }
  });
}

function setupEvents() {
  document.getElementById('nav-dashboard')?.addEventListener('click', () => { activeView = 'dashboard'; render(); });
  document.getElementById('nav-simulator')?.addEventListener('click', () => { activeView = 'simulator'; render(); });
  document.getElementById('btn-open-modal')?.addEventListener('click', () => { isModalOpen = true; render(); });
  document.getElementById('btn-ai-process')?.addEventListener('click', () => {
    const txt = (document.getElementById('input-text') as HTMLTextAreaElement).value;
    if (txt) runAICommand(txt);
  });
  
  const textEl = document.getElementById('input-text') as HTMLTextAreaElement;
  textEl?.addEventListener('input', () => {
    const val = textEl.value;
    document.getElementById('char-count')!.textContent = val.length.toLocaleString();
    document.getElementById('token-count')!.textContent = Math.ceil(val.length / 4).toLocaleString();
  });

  // Interação com Chips de Sugestão
  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const text = (e.currentTarget as HTMLElement).dataset.text;
      if (text && textEl) {
        textEl.value = text;
        textEl.dispatchEvent(new Event('input')); // Dispara contagem
      }
    });
  });

  document.querySelectorAll('.delete').forEach(b => b.addEventListener('click', (e) => {
    if (confirm('Tem certeza que deseja remover este cliente permanentemente?')) {
      const id = (e.currentTarget as HTMLElement).dataset.id;
      clients = clients.filter(c => c.id !== id);
      saveData();
    }
  }));

  document.getElementById('btn-save-client')?.addEventListener('click', () => {
    const name = (document.getElementById('modal-name') as HTMLInputElement).value;
    const limit = (document.getElementById('modal-limit') as HTMLInputElement).value;
    if (name) {
      clients.push({ id: crypto.randomUUID(), name, apiKey: encrypt('KEY_'+Math.random()), tokensUsed: 0, limit: parseInt(limit), lastUsed: 'Manual' });
      isModalOpen = false;
      saveData();
    }
  });
}

render();

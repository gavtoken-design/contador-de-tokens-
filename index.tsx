
import { GoogleGenAI } from '@google/genai';
import Chart from 'chart.js';

// --- Types ---
interface Client {
  id: string;
  name: string;
  apiKey: string; 
  tokensUsed: number;
  limit: number;
  lastUsed: string;
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

let rawStorage = localStorage.getItem('api_clients');
let clients: Client[] = [];
if (rawStorage) {
  try {
    if (rawStorage.startsWith('[')) {
      clients = JSON.parse(rawStorage);
      clients = clients.map(c => ({...c, apiKey: encrypt(c.apiKey)}));
      localStorage.setItem('api_clients', encrypt(JSON.stringify(clients)));
    } else {
      clients = JSON.parse(decrypt(rawStorage));
    }
  } catch (e) {
    console.error("Failed to load clients:", e);
    clients = [];
  }
}

let activeView: 'dashboard' | 'simulator' = 'dashboard';
let isModalOpen = false;
let debounceTimer: number;
let visibleKeys: Set<string> = new Set();
let usageChart: Chart | null = null;

// --- API Logic ---
async function getCount(text: string, modelName: string = 'gemini-3-flash-preview') {
  if (!text.trim()) return 0;
  try {
    const response = await ai.models.countTokens({
      model: modelName,
      contents: [{ parts: [{ text }] }],
    });
    return response.totalTokens;
  } catch (error) {
    console.error('Error counting tokens:', error);
    return null;
  }
}

// --- UI Actions ---
function saveClients() {
  const encryptedData = encrypt(JSON.stringify(clients));
  localStorage.setItem('api_clients', encryptedData);
  render();
}

function addClient(name: string, apiKey: string, limit: number) {
  const newClient: Client = {
    id: crypto.randomUUID(),
    name,
    apiKey: encrypt(apiKey),
    tokensUsed: 0,
    limit,
    lastUsed: 'Nunca'
  };
  clients.push(newClient);
  saveClients();
}

function deleteClient(id: string) {
  clients = clients.filter(c => c.id !== id);
  saveClients();
}

function simulateUsage(clientId: string, tokens: number) {
  const client = clients.find(c => c.id === clientId);
  if (client) {
    client.tokensUsed += tokens;
    client.lastUsed = new Date().toLocaleString('pt-BR');
    saveClients();
    alert(`Simulação: ${tokens} tokens debitados de ${client.name}`);
  }
}

function toggleKeyVisibility(id: string) {
  if (visibleKeys.has(id)) {
    visibleKeys.delete(id);
  } else {
    visibleKeys.add(id);
  }
  render();
}

// --- Visualization ---
function initUsageChart() {
  const ctx = document.getElementById('usage-chart-canvas') as HTMLCanvasElement;
  if (!ctx) return;

  if (usageChart) {
    usageChart.destroy();
  }

  const data = {
    labels: clients.map(c => c.name),
    datasets: [
      {
        label: 'Tokens Usados',
        data: clients.map(c => c.tokensUsed),
        backgroundColor: '#4285f4',
        borderRadius: 4,
      },
      {
        label: 'Limite Mensal',
        data: clients.map(c => c.limit),
        backgroundColor: 'rgba(0, 0, 0, 0.1)',
        borderRadius: 4,
      }
    ]
  };

  usageChart = new Chart(ctx, {
    type: 'bar',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Tokens'
          }
        },
        x: {
          grid: {
            display: false
          }
        }
      },
      plugins: {
        legend: {
          position: 'top',
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const val = context.parsed.y;
              return ` ${context.dataset.label}: ${val.toLocaleString()}`;
            }
          }
        }
      }
    }
  });
}

// --- Rendering Engine ---
function render() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="dashboard-layout">
      <aside class="sidebar">
        <div class="logo">API Manager <span>v2</span></div>
        <nav>
          <button class="nav-item ${activeView === 'dashboard' ? 'active' : ''}" id="nav-dashboard">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Clientes
          </button>
          <button class="nav-item ${activeView === 'simulator' ? 'active' : ''}" id="nav-simulator">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7"></path><line x1="16" y1="19" x2="22" y2="19"></line><line x1="19" y1="16" x2="19" y2="22"></line></svg>
            Simulador de Tokens
          </button>
        </nav>
      </aside>

      <main class="main-content">
        ${activeView === 'dashboard' ? renderDashboard() : renderSimulator()}
      </main>
    </div>

    ${isModalOpen ? renderModal() : ''}
  `;

  setupEventListeners();

  if (activeView === 'dashboard' && clients.length > 0) {
    initUsageChart();
  }
}

function renderDashboard() {
  const totalTokens = clients.reduce((sum, c) => sum + c.tokensUsed, 0);
  
  return `
    <header class="content-header">
      <h2>Gestão de Clientes</h2>
      <button class="btn-primary" id="btn-open-modal">+ Novo Cliente</button>
    </header>

    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Total de Clientes</span>
        <span class="stat-value">${clients.length}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Uso Total (Tokens)</span>
        <span class="stat-value">${totalTokens.toLocaleString()}</span>
      </div>
    </div>

    ${clients.length > 0 ? `
      <div class="chart-section stat-card">
        <span class="stat-label">Comparativo de Uso vs Limite</span>
        <div class="chart-container">
          <canvas id="usage-chart-canvas"></canvas>
        </div>
      </div>
    ` : ''}

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>API Key (Protegida)</th>
            <th>Uso / Limite</th>
            <th>Último Uso</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${clients.map(client => {
            const percent = Math.min((client.tokensUsed / client.limit) * 100, 100);
            const isVisible = visibleKeys.has(client.id);
            const displayKey = isVisible ? decrypt(client.apiKey) : '••••••••••••••••';
            return `
              <tr>
                <td><strong>${client.name}</strong></td>
                <td>
                  <div class="key-wrapper">
                    <code>${displayKey}</code>
                    <button class="btn-text toggle-visibility" data-id="${client.id}">
                      ${isVisible ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                </td>
                <td>
                  <div class="usage-bar-container">
                    <div class="usage-bar" style="width: ${percent}%; background: ${percent > 90 ? '#ea4335' : '#34a853'}"></div>
                  </div>
                  <small>${client.tokensUsed.toLocaleString()} / ${client.limit.toLocaleString()}</small>
                </td>
                <td>${client.lastUsed}</td>
                <td>
                  <button class="btn-icon delete" data-id="${client.id}">Excluir</button>
                </td>
              </tr>
            `;
          }).join('')}
          ${clients.length === 0 ? '<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--secondary-text)">Nenhum cliente cadastrado.</td></tr>' : ''}
        </tbody>
      </table>
    </div>
  `;
}

function renderModal() {
  return `
    <div class="modal-overlay">
      <div class="modal-content">
        <h3>Cadastrar Novo Cliente</h3>
        <form id="add-client-form">
          <div class="field-group">
            <label>Nome do Cliente</label>
            <input type="text" id="modal-name" required placeholder="Ex: App Marketplace">
          </div>
          <div class="field-group">
            <label>API Key Real (Será criptografada localmente)</label>
            <input type="password" id="modal-key" required placeholder="Insira a chave do cliente">
          </div>
          <div class="field-group">
            <label>Limite Mensal (Tokens)</label>
            <input type="number" id="modal-limit" required value="100000">
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="btn-close-modal">Cancelar</button>
            <button type="submit" class="btn-primary">Salvar Cliente</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderSimulator() {
  return `
    <header class="content-header">
      <h2>Simulador de Requisição</h2>
      <p>Estime o peso das mensagens antes de processar via API.</p>
    </header>

    <div class="simulator-grid">
      <div class="editor-pane">
        <div class="field-group">
          <label>Atribuir simulação ao cliente:</label>
          <select id="client-selector">
            <option value="">Apenas contar (sem atribuir)</option>
            ${clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>
        <textarea id="input-text" placeholder="Digite o prompt ou texto aqui..."></textarea>
        <div class="editor-footer">
          <button class="btn-primary" id="btn-debit" disabled>Debitar Uso Simulado</button>
          <span id="status-text">Aguardando entrada...</span>
        </div>
      </div>

      <div class="results-pane">
        <div class="result-card primary">
          <span class="label">Total de Tokens</span>
          <span id="token-count" class="value">0</span>
        </div>
        <div class="result-card">
          <span class="label">Caracteres</span>
          <span id="char-count" class="value">0</span>
        </div>
        <div class="result-card">
          <span class="label">Palavras</span>
          <span id="word-count" class="value">0</span>
        </div>
      </div>
    </div>
  `;
}

function setupEventListeners() {
  document.getElementById('nav-dashboard')?.addEventListener('click', () => { activeView = 'dashboard'; render(); });
  document.getElementById('nav-simulator')?.addEventListener('click', () => { activeView = 'simulator'; render(); });

  if (activeView === 'dashboard') {
    document.getElementById('btn-open-modal')?.addEventListener('click', () => {
      isModalOpen = true;
      render();
    });

    document.querySelectorAll('.toggle-visibility').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).dataset.id;
        if (id) toggleKeyVisibility(id);
      });
    });

    document.querySelectorAll('.btn-icon.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).dataset.id;
        if (id && confirm('Deseja remover este cliente?')) deleteClient(id);
      });
    });
  }

  if (isModalOpen) {
    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      isModalOpen = false;
      render();
    });

    document.getElementById('add-client-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (document.getElementById('modal-name') as HTMLInputElement).value;
      const key = (document.getElementById('modal-key') as HTMLInputElement).value;
      const limit = parseInt((document.getElementById('modal-limit') as HTMLInputElement).value);
      
      if (name && key && limit > 0) {
        addClient(name, key, limit);
        isModalOpen = false;
        render();
      }
    });
  }

  if (activeView === 'simulator') {
    const textarea = document.getElementById('input-text') as HTMLTextAreaElement;
    const debitBtn = document.getElementById('btn-debit') as HTMLButtonElement;
    const clientSelector = document.getElementById('client-selector') as HTMLSelectElement;

    textarea?.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(async () => {
        const text = textarea.value;
        const charCount = document.getElementById('char-count');
        const wordCount = document.getElementById('word-count');
        const tokenCount = document.getElementById('token-count');
        
        if (charCount) charCount.textContent = text.length.toString();
        if (wordCount) wordCount.textContent = text.trim() ? text.trim().split(/\s+/).length.toString() : '0';
        
        const status = document.getElementById('status-text');
        if (status) status.textContent = 'Calculando...';
        
        const tokens = await getCount(text);
        if (tokens !== null) {
          if (tokenCount) tokenCount.textContent = tokens.toString();
          if (status) status.textContent = 'Pronto';
          debitBtn.disabled = tokens === 0 || !clientSelector.value;
        }
      }, 500);
    });

    clientSelector?.addEventListener('change', () => {
      const tokens = parseInt(document.getElementById('token-count')!.textContent || '0');
      debitBtn.disabled = tokens === 0 || !clientSelector.value;
    });

    debitBtn?.addEventListener('click', () => {
      const tokens = parseInt(document.getElementById('token-count')!.textContent || '0');
      const clientId = clientSelector.value;
      if (clientId && tokens > 0) {
        simulateUsage(clientId, tokens);
        textarea.value = '';
        render();
      }
    });
  }
}

// Initial Init
render();

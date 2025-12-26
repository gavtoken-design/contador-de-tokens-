
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

// Initial Load
const rawStorage = localStorage.getItem('api_clients_v3');
if (rawStorage) {
  try {
    const decrypted = JSON.parse(decrypt(rawStorage));
    clients = decrypted.clients || [];
    usageLogs = decrypted.logs || [];
  } catch (e) {
    console.error("Failed to load data:", e);
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
function saveData() {
  const data = { clients, logs: usageLogs };
  const encryptedData = encrypt(JSON.stringify(data));
  localStorage.setItem('api_clients_v3', encryptedData);
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
  saveData();
}

function deleteClient(id: string) {
  clients = clients.filter(c => c.id !== id);
  usageLogs = usageLogs.filter(l => l.clientId !== id);
  saveData();
}

function simulateUsage(clientId: string, tokens: number) {
  const client = clients.find(c => c.id === clientId);
  if (client) {
    const now = new Date();
    client.tokensUsed += tokens;
    client.lastUsed = now.toLocaleString('pt-BR');
    
    const newLog: UsageLog = {
      id: crypto.randomUUID(),
      clientId,
      clientName: client.name,
      tokens,
      timestamp: now.toLocaleString('pt-BR'),
      timestampIso: now.toISOString()
    };
    usageLogs.unshift(newLog);
    
    if (usageLogs.length > 100) usageLogs.pop();
    saveData();
    alert(`Sucesso: ${tokens} tokens registrados para ${client.name}`);
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
  if (usageChart) usageChart.destroy();

  usageChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: clients.map(c => c.name),
      datasets: [
        {
          label: 'Tokens Usados',
          data: clients.map(c => c.tokensUsed),
          backgroundColor: '#4285f4',
          borderRadius: 4,
        },
        {
          label: 'Limite',
          data: clients.map(c => c.limit),
          backgroundColor: 'rgba(0, 0, 0, 0.08)',
          borderRadius: 4,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: { display: true, position: 'bottom' }
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
        <div class="logo">Manager <span>API</span></div>
        <nav>
          <button class="nav-item ${activeView === 'dashboard' ? 'active' : ''}" id="nav-dashboard">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            <span>Dashboard</span>
          </button>
          <button class="nav-item ${activeView === 'simulator' ? 'active' : ''}" id="nav-simulator">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7"></path><line x1="16" y1="19" x2="22" y2="19"></line><line x1="19" y1="16" x2="19" y2="22"></line></svg>
            <span>Simulador</span>
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
  if (activeView === 'dashboard' && clients.length > 0) initUsageChart();
}

function renderDashboard() {
  const totalTokens = clients.reduce((sum, c) => sum + c.tokensUsed, 0);
  
  const filteredLogs = usageLogs.filter(log => {
    if (!log.timestampIso) return true;
    const logDate = new Date(log.timestampIso);
    logDate.setHours(0, 0, 0, 0);
    
    if (filterStartDate) {
      const start = new Date(filterStartDate);
      start.setHours(0, 0, 0, 0);
      if (logDate < start) return false;
    }
    
    if (filterEndDate) {
      const end = new Date(filterEndDate);
      end.setHours(0, 0, 0, 0);
      if (logDate > end) return false;
    }
    return true;
  });

  return `
    <header class="content-header">
      <div>
        <h2>Dashboard</h2>
        <p class="subtitle">Visão geral do consumo de tokens</p>
      </div>
      <button class="btn-primary" id="btn-open-modal">Novo Cliente</button>
    </header>

    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Clientes</span>
        <span class="stat-value">${clients.length}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Tokens Totais</span>
        <span class="stat-value">${totalTokens.toLocaleString()}</span>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="main-column">
        ${clients.length > 0 ? `
          <div class="chart-section stat-card">
            <span class="stat-label">Uso vs Limite</span>
            <div class="chart-container">
              <canvas id="usage-chart-canvas"></canvas>
            </div>
          </div>
        ` : ''}

        <div class="table-container">
          <div class="table-header">Clientes Ativos</div>
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Chave API</th>
                <th>Consumo</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${clients.map(client => {
                const percent = Math.min((client.tokensUsed / client.limit) * 100, 100);
                const isVisible = visibleKeys.has(client.id);
                return `
                  <tr>
                    <td><strong>${client.name}</strong></td>
                    <td>
                      <div class="key-wrapper">
                        <code>${isVisible ? decrypt(client.apiKey) : '••••••••'}</code>
                        <button class="btn-text toggle-visibility" data-id="${client.id}">${isVisible ? 'Ocultar' : 'Ver'}</button>
                      </div>
                    </td>
                    <td>
                      <div class="usage-bar-container">
                        <div class="usage-bar" style="width: ${percent}%; background: ${percent > 90 ? '#ea4335' : '#34a853'}"></div>
                      </div>
                      <small>${client.tokensUsed.toLocaleString()} / ${client.limit.toLocaleString()}</small>
                    </td>
                    <td>
                      <button class="btn-icon delete" data-id="${client.id}">Remover</button>
                    </td>
                  </tr>
                `;
              }).join('')}
              ${clients.length === 0 ? '<tr><td colspan="4" class="empty-state">Sem dados.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>

      <div class="side-column">
        <div class="history-card stat-card">
          <span class="stat-label">Histórico</span>
          <div class="filter-controls">
            <div class="filter-group">
              <label>De:</label>
              <input type="date" id="filter-start" value="${filterStartDate}">
            </div>
            <div class="filter-group">
              <label>Até:</label>
              <input type="date" id="filter-end" value="${filterEndDate}">
            </div>
            ${(filterStartDate || filterEndDate) ? `<button class="btn-clear-filters" id="btn-clear-filters">Resetar</button>` : ''}
          </div>
          <div class="logs-list">
            ${filteredLogs.length > 0 ? filteredLogs.slice(0, 15).map(log => `
              <div class="log-item">
                <div class="log-info">
                  <span class="log-client">${log.clientName}</span>
                  <span class="log-time">${log.timestamp}</span>
                </div>
                <div class="log-amount">+${log.tokens.toLocaleString()}</div>
              </div>
            `).join('') : '<p class="empty-logs">Nenhum registro.</p>'}
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
        <h3>Novo Cliente</h3>
        <form id="add-client-form">
          <div class="field-group">
            <label>Nome</label>
            <input type="text" id="modal-name" required>
          </div>
          <div class="field-group">
            <label>API Key</label>
            <input type="password" id="modal-key" required>
          </div>
          <div class="field-group">
            <label>Limite Mensal</label>
            <input type="number" id="modal-limit" required value="100000">
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-secondary" id="btn-close-modal">Fechar</button>
            <button type="submit" class="btn-primary">Criar</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderSimulator() {
  return `
    <header class="content-header">
      <div>
        <h2>Simulador</h2>
        <p class="subtitle">Teste o peso das suas requisições</p>
      </div>
    </header>
    <div class="simulator-grid">
      <div class="editor-pane">
        <div class="field-group">
          <label>Vincular ao cliente:</label>
          <select id="client-selector" style="padding: 8px; border-radius: 6px; border: 1px solid var(--border);">
            <option value="">Nenhum (Apenas contagem)</option>
            ${clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
        </div>
        <textarea id="input-text" placeholder="Cole seu texto aqui..."></textarea>
        <div class="editor-footer">
          <button class="btn-primary" id="btn-debit" disabled>Debitar Tokens</button>
          <span id="status-text">Pronto</span>
        </div>
      </div>
      <div class="results-pane">
        <div class="result-card primary">
          <span class="label">Tokens</span>
          <span id="token-count" class="value">0</span>
        </div>
        <div class="result-card">
          <span class="label">Chars</span>
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
    document.getElementById('btn-open-modal')?.addEventListener('click', () => { isModalOpen = true; render(); });
    document.getElementById('filter-start')?.addEventListener('change', (e) => { filterStartDate = (e.target as HTMLInputElement).value; render(); });
    document.getElementById('filter-end')?.addEventListener('change', (e) => { filterEndDate = (e.target as HTMLInputElement).value; render(); });
    document.getElementById('btn-clear-filters')?.addEventListener('click', () => { filterStartDate = ''; filterEndDate = ''; render(); });
    document.querySelectorAll('.toggle-visibility').forEach(btn => btn.addEventListener('click', (e) => toggleKeyVisibility((e.target as HTMLElement).dataset.id!)));
    document.querySelectorAll('.btn-icon.delete').forEach(btn => btn.addEventListener('click', (e) => confirm('Remover?') && deleteClient((e.target as HTMLElement).dataset.id!)));
  }

  if (isModalOpen) {
    document.getElementById('btn-close-modal')?.addEventListener('click', () => { isModalOpen = false; render(); });
    document.getElementById('add-client-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      addClient((document.getElementById('modal-name') as HTMLInputElement).value, 
                (document.getElementById('modal-key') as HTMLInputElement).value, 
                parseInt((document.getElementById('modal-limit') as HTMLInputElement).value));
      isModalOpen = false; render();
    });
  }

  if (activeView === 'simulator') {
    const textEl = document.getElementById('input-text') as HTMLTextAreaElement;
    textEl?.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(async () => {
        const text = textEl.value;
        document.getElementById('char-count')!.textContent = text.length.toLocaleString();
        document.getElementById('word-count')!.textContent = text.trim() ? text.trim().split(/\s+/).length.toLocaleString() : '0';
        const tokens = await getCount(text);
        if (tokens !== null) {
          document.getElementById('token-count')!.textContent = tokens.toLocaleString();
          (document.getElementById('btn-debit') as HTMLButtonElement).disabled = tokens === 0 || !(document.getElementById('client-selector') as HTMLSelectElement).value;
        }
      }, 500);
    });
    document.getElementById('btn-debit')?.addEventListener('click', () => {
      const tokens = parseInt(document.getElementById('token-count')!.textContent?.replace(/,/g, '') || '0');
      simulateUsage((document.getElementById('client-selector') as HTMLSelectElement).value, tokens);
      textEl.value = ''; render();
    });
  }
}

render();

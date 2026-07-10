// ──────── FINDY AI CHAT ────────
const input = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages');
const chatContainer = document.getElementById('chat-container');
const typingIndicator = document.getElementById('typing-indicator');
const resetBtn = document.getElementById('reset-btn');
const headerTitle = document.getElementById('header-title');
const headerSubtitle = document.getElementById('header-subtitle');
const chatView = document.getElementById('chat-view');
const sourcesView = document.getElementById('sources-view');
const sourcesContent = document.getElementById('sources-content');

let sessionId = 'findy_' + Date.now();
let currentMode = 'default';
let isProcessing = false;
let abortController = null;

// Sidebar items
const chatDefault = document.getElementById('chat-default');
const chatConnected = document.getElementById('chat-connected');
const sourceNissan = document.getElementById('source-nissan');
const sourcesBackBtn = document.getElementById('sources-back-btn');

chatDefault.addEventListener('click', () => switchMode('default'));
chatConnected.addEventListener('click', () => switchMode('connected'));
sourceNissan.addEventListener('click', showSources);
sourcesBackBtn.addEventListener('click', hideSources);

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  sendBtn.disabled = !input.value.trim();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

sendBtn.addEventListener('click', sendMessage);
resetBtn.addEventListener('click', resetConversation);

// ---- View Switching ----
function showSources() {
  chatView.classList.add('hidden');
  sourcesView.classList.remove('hidden');
  loadSourcesData();
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  sourceNissan.classList.add('active');
}

function hideSources() {
  sourcesView.classList.add('hidden');
  chatView.classList.remove('hidden');
  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  if (currentMode === 'connected') chatConnected.classList.add('active');
  else chatDefault.classList.add('active');
}

async function loadSourcesData() {
  sourcesContent.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Loading source data...</div>';
  try {
    const res = await fetch('/api/sources');
    const data = await res.json();
    renderSources(data);
  } catch (e) {
    sourcesContent.innerHTML = '<div style="text-align:center;padding:40px;color:var(--iron-red)">Failed to load source data</div>';
  }
}

function renderSources(data) {
  if (!data.vehicles || data.vehicles.length === 0) {
    sourcesContent.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">No vehicle data available</div>';
    return;
  }

  let html = '<div class="sources-grid">';

  // Header
  html += '<div class="source-analytics-header">';
  html += '<div><h2>Nissan Springs</h2><span class="domain">nissansprings.co.za</span></div>';
  html += '<div class="source-meta">';
  html += '<span>🔄 Last scraped: ' + new Date(data.scrapedAt).toLocaleString() + '</span>';
  html += '<span>🚗 ' + data.totalVehicles + ' models tracked</span>';
  html += '</div></div>';

  // Stats row
  html += '<div class="stats-row">';
  html += '<div class="stat-card"><div class="stat-value">' + (data.bestSelling ? data.bestSelling.sales : 0) + '</div><div class="stat-label">Best Seller Sales</div></div>';
  html += '<div class="stat-card"><div class="stat-value">' + (data.bestSelling ? data.bestSelling.name : '-') + '</div><div class="stat-label">🏆 Best Selling</div></div>';
  html += '<div class="stat-card"><div class="stat-value">' + formatNumber(data.mostViewed ? data.mostViewed.views : 0) + '</div><div class="stat-label">⭐ Most Views</div></div>';
  html += '</div>';

  // Best Selling section
  html += '<div class="section-title">🏆 Best Selling</div>';
  data.topBySales.forEach((v, i) => {
    html += renderVehicleCard(v, i + 1, 'sales');
  });

  // Most Viewed section
  html += '<div class="section-title">👁️ Most Viewed</div>';
  data.topByViews.forEach((v, i) => {
    html += renderVehicleCard(v, i + 1, 'views');
  });

  // All vehicles
  html += '<div class="section-title">🚗 All Vehicles</div>';
  data.vehicles.forEach(v => {
    html += '<div class="vehicle-card" style="border-left:3px solid ' + (v.color || '#d4a535') + '">';
    html += '<div class="vehicle-info">';
    html += '<h3>' + v.name + '</h3>';
    html += '<span class="type-tag">' + v.type + '</span>';
    html += '<span class="spec">' + (v.price || '') + (v.payload ? ' · Payload: ' + v.payload : '') + (v.engine ? ' · ' + v.engine : '') + '</span>';
    html += '</div>';
    html += '<div class="vehicle-metrics">';
    html += '<div class="metric"><div class="metric-val">' + v.views.toLocaleString() + '</div><div class="metric-label">Views</div></div>';
    html += '<div class="metric"><div class="metric-val">' + v.sales + '</div><div class="metric-label">Sales</div></div>';
    html += '<div class="metric"><div class="metric-val ' + (v.trend === 'up' ? 'trend-up' : 'trend-stable') + '">' + (v.trend === 'up' ? '📈' : '➡️') + '</div><div class="metric-label">Trend</div></div>';
    html += '</div>';
    html += '</div>';
  });

  html += '</div>';
  sourcesContent.innerHTML = html;
}

function renderVehicleCard(v, rank, type) {
  const rankClass = rank <= 3 ? ' rank-' + rank : '';
  const metricVal = type === 'sales' ? v.sales : formatNumber(v.views);
  const metricLabel = type === 'sales' ? 'Sales' : 'Views';
  return '<div class="vehicle-card" style="border-left:3px solid ' + (v.color || '#d4a535') + '">' +
    '<div class="vehicle-rank' + rankClass + '">#' + rank + '</div>' +
    '<div class="vehicle-info">' +
    '<h3>' + v.name + '</h3>' +
    '<span class="type-tag">' + v.type + '</span>' +
    '<span class="spec">' + (v.price || '') + '</span>' +
    '</div>' +
    '<div class="vehicle-metrics">' +
    '<div class="metric"><div class="metric-val">' + metricVal + '</div><div class="metric-label">' + metricLabel + '</div></div>' +
    '<div class="metric"><div class="metric-val ' + (v.trend === 'up' ? 'trend-up' : 'trend-stable') + '">' + (v.trend === 'up' ? '📈' : '➡️') + '</div><div class="metric-label">Trend</div></div>' +
    '</div></div>';
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toString();
}

// ---- Mode Switching ----
function switchMode(mode) {
  if (mode === currentMode && !chatView.classList.contains('hidden')) return;
  hideSources();
  currentMode = mode;
  sessionId = 'findy_' + Date.now();

  document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
  if (mode === 'default') {
    chatDefault.classList.add('active');
    headerTitle.textContent = 'Findy';
    headerSubtitle.textContent = 'Your AI assistant · Smart · Efficient';
    input.placeholder = 'Ask me anything, sir...';
  } else {
    chatConnected.classList.add('active');
    headerTitle.textContent = 'Findy · Nissan Springs';
    headerSubtitle.textContent = 'Connected to nissansprings.co.za';
    input.placeholder = 'Ask about Nissan Springs, sir...';
  }
  messagesContainer.innerHTML = getWelcomeHTML(mode);
  hideTyping();
}

function getWelcomeHTML(mode) {
  if (mode === 'default') {
    return '<div class="message welcome"><div class="avatar findy-avatar"><div class="mini-reactor"><div class="mr-ring"></div><div class="mr-core"></div></div></div><div class="bubble"><div class="bubble-header">Findy</div><div class="bubble-content">At your service, sir. I\'m <strong>Findy</strong> — ready to help with whatever you need.</div></div></div>';
  }
  return '<div class="message welcome"><div class="avatar findy-avatar"><div class="mini-reactor"><div class="mr-ring"></div><div class="mr-core"></div></div></div><div class="bubble"><div class="bubble-header">Findy · Nissan Springs</div><div class="bubble-content">Connected to <strong>Nissan Springs</strong> 🏢. Ask me about their vehicles, services, or promotions, sir.</div></div></div>';
}

function renderContent(text) {
  let html = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => '<pre><code' + (lang ? ' class="language-'+lang+'"' : '') + '>' + htmlEscape(code.trim()) + '</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function htmlEscape(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function addMessage(role, content, isStreaming) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  const avatar = role === 'assistant'
    ? '<div class="avatar findy-avatar"><div class="mini-reactor"><div class="mr-ring"></div><div class="mr-core"></div></div></div>'
    : '<div class="avatar user-avatar">👤</div>';
  const header = role === 'assistant' ? 'FINDY' : 'YOU';
  const rendered = role === 'assistant' ? renderContent(content) : content.replace(/\n/g, '<br>');
  div.innerHTML = avatar + '<div class="bubble"><div class="bubble-header">' + header + '</div><div class="bubble-content">' + rendered + '</div></div>';
  if (isStreaming) {
    const existing = messagesContainer.querySelector('.message.streaming');
    if (existing) { existing.querySelector('.bubble-content').innerHTML = rendered; scrollToBottom(); return existing; }
    div.classList.add('streaming');
  }
  messagesContainer.appendChild(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() { setTimeout(() => { chatContainer.scrollTop = chatContainer.scrollHeight; }, 10); }
function showTyping() { typingIndicator.classList.remove('hidden'); scrollToBottom(); }
function hideTyping() { typingIndicator.classList.add('hidden'); }

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isProcessing) return;
  input.value = ''; input.style.height = 'auto'; sendBtn.disabled = true; isProcessing = true;
  addMessage('user', text); showTyping();
  abortController = new AbortController();
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId, mode: currentMode }),
      signal: abortController.signal,
    });
    if (!response.ok) { const err = await response.text(); addMessage('assistant', 'Error: ' + err); hideTyping(); isProcessing = false; sendBtn.disabled = !input.value.trim(); return; }
    hideTyping();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', assistantMsg = null, fullContent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            fullContent += parsed.content;
            if (!assistantMsg) assistantMsg = addMessage('assistant', fullContent, true);
            else { assistantMsg.querySelector('.bubble-content').innerHTML = renderContent(fullContent); scrollToBottom(); }
          }
          if (parsed.error) addMessage('assistant', 'Error: ' + parsed.error);
        } catch {}
      }
    }
    if (assistantMsg) assistantMsg.querySelector('.bubble-content').innerHTML = renderContent(fullContent);
  } catch (err) {
    if (err.name === 'AbortError') return;
    hideTyping(); addMessage('assistant', 'Connection error: ' + err.message);
  }
  isProcessing = false; sendBtn.disabled = !input.value.trim();
}

async function resetConversation() {
  if (isProcessing && abortController) { abortController.abort(); isProcessing = false; }
  sessionId = 'findy_' + Date.now();
  messagesContainer.innerHTML = getWelcomeHTML(currentMode);
  hideTyping(); sendBtn.disabled = true;
}

input.focus();
// Constantes
const MONITORING_DURATION = 10000; // 10 segundos para pruebas rápidas
const SAMPLE_RATE = 100; // Hz aproximado

// Estado de la aplicación
const state = {
    isMonitoring: false,
    samples: [],
    timestamps: [],
    measurements: [],
    animationId: null,
    startTime: 0,
    wakeLock: null,
    deferredPrompt: null,
};

// Elementos del DOM cacheados
const dom = {
    startBtn: document.getElementById('startBtn'),
    status: document.getElementById('status'),
    realTimeViz: document.getElementById('realTimeViz'),
    exportBtn: document.getElementById('exportBtn'),
};

// Cargar mediciones guardadas
function loadMeasurements() {
    const saved = localStorage.getItem('parkinson_measurements');
    if (saved) {
        state.measurements = JSON.parse(saved);
        // Filtrar solo las de hoy
        const today = new Date().toDateString();
        state.measurements = state.measurements.filter(m => 
            new Date(m.timestamp).toDateString() === today
        );
    }
}

// Guardar medición
function saveMeasurement(data) {
    state.measurements.push(data);
    localStorage.setItem('parkinson_measurements', JSON.stringify(state.measurements));
}

// Iniciar monitoreo
function startMonitoring() {
    // Verificar soporte de acelerómetro
    if (!window.DeviceMotionEvent) {
        alert('❌ Tu dispositivo no soporta el acelerómetro');
        return;
    }

    // Feedback visual inmediato
    dom.startBtn.disabled = true;
    dom.startBtn.innerHTML = '<span>⌛</span> Solicitando permisos...';

    // Solicitar permisos en iOS
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    beginMonitoring();
                } else {
                    dom.startBtn.disabled = false;
                    dom.startBtn.innerHTML = '▶️ Iniciar Medición';
                    alert('❌ Se necesitan permisos para acceder al acelerómetro');
                }
            })
            .catch(err => {
                console.error(err);
                dom.startBtn.disabled = false;
                dom.startBtn.innerHTML = '▶️ Iniciar Medición';
                alert('❌ Ocurrió un error al solicitar permisos.');
            });
    } else {
        beginMonitoring();
    }
}

function beginMonitoring() {
    state.isMonitoring = true;
    state.samples = [];
    state.timestamps = [];
    state.startTime = Date.now();

    dom.startBtn.disabled = false;
    dom.startBtn.innerHTML = '🛑 Detener';
    dom.startBtn.className = 'btn btn-stop';
    dom.status.textContent = '📊 Monitoreando... Mantenga el teléfono firme';
    dom.realTimeViz.style.display = 'block';

    // Iniciar canvas
    initCanvas();

    // Escuchar eventos del acelerómetro
    window.addEventListener('devicemotion', handleMotion);
    
    // Timer para detener automáticamente
    setTimeout(() => {
        if (state.isMonitoring) {
            stopMonitoring();
        }
    }, MONITORING_DURATION);

    // Actualizar contador
    updateTimer();
}

function updateTimer() {
    if (!state.isMonitoring) return;

    const elapsed = Date.now() - state.startTime;
    const remaining = Math.ceil((MONITORING_DURATION - elapsed) / 1000);
    
    if (remaining > 0) {
        dom.status.textContent = 
            `📊 Monitoreando... ${remaining} segundos restantes`;
        setTimeout(updateTimer, 1000);
    }
}

function handleMotion(event) {
    if (!state.isMonitoring) return;

    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const x = acc.x || 0;
    const y = acc.y || 0;
    const z = acc.z || 0;

    // Calcular magnitud
    const magnitude = Math.sqrt(x*x + y*y + z*z);

    state.samples.push({ x, y, z, magnitude });
    state.timestamps.push(Date.now());

    // Actualizar UI cada 5 samples
    if (state.samples.length % 5 === 0) {
        updateRealTimeMetrics();
        drawWave();
    }
}

function updateRealTimeMetrics() {
    // Para la UI en tiempo real, solo usamos los últimos 100 samples para que sea fluido
    const recentSamples = state.samples.slice(-100);
    if (recentSamples.length < 20) return;

    const metrics = calculateTremorMetrics(recentSamples);
    
    // Actualizar los valores numéricos en la UI
    document.getElementById('tremorLevel').textContent = metrics.severityLevel.toFixed(1);
    document.getElementById('frequency').textContent = metrics.dominantFrequency.toFixed(2);
    document.getElementById('amplitude').textContent = metrics.amplitudeRMS.toFixed(2);
    document.getElementById('sampleCount').textContent = state.samples.length;

    // La barra de progreso ahora refleja el tiempo transcurrido
    const timeElapsed = Date.now() - state.startTime;
    const progress = Math.min(100, (timeElapsed / MONITORING_DURATION) * 100);
    const fill = document.getElementById('progressFill');
    fill.style.width = progress + '%';

    // El color de la barra de progreso refleja la severidad del temblor
    fill.style.backgroundColor = getSeverityColor(metrics.severityLevel);
}

function stopMonitoring() {
    state.isMonitoring = false;
    window.removeEventListener('devicemotion', handleMotion);
    
    if (state.animationId) {
        cancelAnimationFrame(state.animationId);
    }

    dom.startBtn.innerHTML = '▶️ Iniciar Medición';
    dom.startBtn.className = 'btn btn-primary';
    dom.realTimeViz.style.display = 'none';

    // Analizar resultados finales
    if (state.samples.length > 100) {
        const metrics = calculateTremorMetrics(state.samples);
        displayResults(metrics);
        
        // Guardar medición
        const measurement = {
            timestamp: Date.now(),
            ...metrics,
            interpretation: interpretLevel(metrics.severityLevel)
        };
        saveMeasurement(measurement);
        
        // Actualizar historial
        updateHistory();
    } else {
        dom.status.textContent = 
            '⚠️ Medición muy corta. Intente de nuevo.';
        // Guardar el intento fallido en el historial
        const failedMeasurement = {
            timestamp: Date.now(),
            error: true,
            interpretation: 'Error: Medición muy corta'
        };
        saveMeasurement(failedMeasurement);
        updateHistory();
    }
}

function calculateTremorMetrics(sampleData) {
    // Extraer magnitudes
    const magnitudes = sampleData.map(s => s.magnitude);
    
    // Remover componente DC (gravedad)
    const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
    const filtered = magnitudes.map(m => m - mean);

    // Calcular RMS (amplitud)
    const rms = Math.sqrt(
        filtered.reduce((sum, val) => sum + val * val, 0) / filtered.length
    );

    // Análisis de frecuencia simplificado (autocorrelación)
    const { frequency, power } = findDominantFrequency(filtered);

    // Calcular severidad (0-10)
    const severity = calculateSeverity(rms, frequency, power);

    return {
        amplitudeRMS: rms,
        dominantFrequency: frequency,
        tremorPower: power,
        severityLevel: severity
    };
}

function findDominantFrequency(data) {
    const n = data.length;
    if (n < 50) return { frequency: 0, power: 0 };

    let maxCorr = 0;
    let dominantFreq = 0;

    // Buscar en rango de Parkinson (3-8 Hz)
    for (let freq = 30; freq <= 80; freq++) {
        const period = Math.floor(SAMPLE_RATE / (freq / 10));
        if (period >= n) continue;

        let corr = 0;
        for (let i = 0; i < n - period; i++) {
            corr += Math.abs(data[i] * data[i + period]);
        }

        if (corr > maxCorr) {
            maxCorr = corr;
            dominantFreq = freq / 10;
        }
    }

    return {
        frequency: dominantFreq,
        power: maxCorr / n
    };
}

function calculateSeverity(rms, frequency, power) {
    let score = 0;

    // --- AJUSTE DE HIPERSENSIBILIDAD PARA PRUEBAS ---
    // El algoritmo ahora se basa principalmente en la amplitud (rms) para que cualquier
    // agitación deliberada del teléfono muestre un resultado inmediato y claro.

    // Factor amplitud (80% del score) - Umbrales muy bajos
    let amplitudeScore = 0;
    if (rms < 0.05) amplitudeScore = 0;
    else if (rms < 0.2) amplitudeScore = 3.0;
    else if (rms < 0.5) amplitudeScore = 6.0;
    else if (rms < 1.0) amplitudeScore = 8.0;
    else amplitudeScore = 10.0;

    // Factor frecuencia (10% del score) - Se da un bonus si hay cualquier frecuencia
    let frequencyScore = 0;
    if (frequency > 1) frequencyScore = 10.0;

    // Factor potencia (10% del score) - Umbrales muy bajos
    let powerScore = 0;
    if (power < 0.01) powerScore = 0;
    else if (power < 0.05) powerScore = 5.0;
    else powerScore = 10.0;

    // Ponderación final
    score = (amplitudeScore * 0.8) + (frequencyScore * 0.1) + (powerScore * 0.1);
    
    return Math.min(10, Math.max(0, score));
}

function interpretLevel(level) {
    if (level < 2) return '✅ Temblor mínimo o ausente';
    if (level < 4) return '🟡 Temblor leve';
    if (level < 7) return '🟠 Temblor moderado';
    return '🔴 Temblor significativo';
}

function getSeverityColor(level) {
    if (level < 2) return 'var(--success-color)';
    if (level < 4) return '#a5d6a7'; // Verde claro
    if (level < 7) return 'var(--warning-color)';
    return 'var(--accent-color)';
}

function displayResults(metrics) {
    const interpretation = interpretLevel(metrics.severityLevel);
    dom.status.innerHTML = 
        `✅ Medición completada<br>${interpretation}`;
}

// Visualización en tiempo real
let canvas, ctx;

function initCanvas() {
    canvas = document.getElementById('waveCanvas');
    ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = 120;
}

function drawWave() {
    if (!ctx || state.samples.length < 2) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    // Tomar últimos 100 samples
    const displaySamples = state.samples.slice(-100);
    const step = width / displaySamples.length;

    // Normalizar y dibujar
    ctx.beginPath();
    ctx.strokeStyle = 'var(--primary-color)';
    ctx.lineWidth = 2;

    displaySamples.forEach((sample, i) => {
        const x = i * step;
        // --- AJUSTE DE SENSIBILIDAD VISUAL --- Se aumenta el multiplicador de 10 a 25
        const normalized = (sample.magnitude - 9.8) * 25; // Centrar en gravedad y amplificar
        const y = centerY + normalized;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();

    // Línea de referencia
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
}

// Sistema de pestañas
function switchTab(event, tabName) {
    // Actualizar botones
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.currentTarget.classList.add('active');

    // Actualizar contenido
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + '-tab').classList.add('active');

    if (tabName === 'history') {
        updateHistory();
    }
}

// Actualizar historial
function updateHistory() {
    loadMeasurements();

    if (state.measurements.length === 0) {
        document.getElementById('summaryStats').innerHTML = 
            '<div class="no-data">No hay mediciones hoy</div>';
        document.getElementById('historyList').innerHTML = 
            '<div class="no-data">Realice su primera medición</div>';
        return;
    }

    // Estadísticas
    const levels = state.measurements.map(m => m.severityLevel);
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    const max = Math.max(...levels);
    const min = Math.min(...levels);

    document.getElementById('summaryStats').innerHTML = `
        <div class="stat-box">
            <div class="stat-value">${avg.toFixed(1)}</div>
            <div class="stat-label">Promedio</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${max.toFixed(1)}</div>
            <div class="stat-label">Máximo</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${min.toFixed(1)}</div>
            <div class="stat-label">Mínimo</div>
        </div>
        <div class="stat-box">
                    <div class="stat-value">${state.measurements.length}</div>
            <div class="stat-label">Mediciones</div>
        </div>
    `;

    // Lista de mediciones
    const historyHTML = state.measurements.map(m => {
        const date = new Date(m.timestamp);
        const time = date.toLocaleTimeString('es-ES', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        if (m.error) {
            return `
                <div class="history-item history-item-error">
                    <div>
                        <div class="history-time">${time}</div>
                    </div>
                    <div style="font-size: 14px; color: var(--accent-color); text-align: right; font-weight: 500;">
                        ${m.interpretation}
                    </div>
                </div>
            `;
        } else {
            const levelClass = `level-${Math.floor(m.severityLevel / 2.5)}`;
            return `
                <div class="history-item">
                    <div>
                        <div class="history-time">${time}</div>
                        <div style="font-size: 12px; color: #666;">
                            ${m.dominantFrequency.toFixed(2)} Hz
                        </div>
                    </div>
                    <div>
                        <div class="history-level ${levelClass}">
                            ${m.severityLevel.toFixed(1)}/10
                        </div>
                        <div style="font-size: 11px; text-align: right;">
                            ${m.interpretation}
                        </div>
                    </div>
                </div>
            `;
        }
    }).reverse().join('');

    document.getElementById('historyList').innerHTML = historyHTML;

    // Dibujar gráfico simple
    drawHistoryChart();
}

function drawHistoryChart() {
    const canvas = document.getElementById('historyChart');
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.offsetWidth;
    canvas.height = 170;
    
    if (state.measurements.length === 0) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 30;

    ctx.clearRect(0, 0, width, height);

    // Ejes
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Líneas de referencia horizontal
    for (let i = 0; i <= 10; i += 2) {
        const y = height - padding - (i / 10) * (height - 2 * padding);
        ctx.strokeStyle = '#f0f0f0';
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();

        // Etiquetas
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(i.toString(), padding - 5, y + 3);
    }

    // Dibujar línea de datos
    const step = (width - 2 * padding) / (state.measurements.length > 1 ? state.measurements.length - 1 : 1);
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;
    ctx.beginPath();

    state.measurements.forEach((m, i) => {
        const x = padding + i * step;
        const y = height - padding - (m.severityLevel / 10) * (height - 2 * padding);
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        // Puntos
        ctx.fillStyle = '#2196F3';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.stroke();

    // Etiquetas de tiempo
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    
    [0, Math.floor(state.measurements.length / 2), state.measurements.length - 1].forEach(i => {
        if (state.measurements[i]) {
            const date = new Date(state.measurements[i].timestamp);
            const time = date.toLocaleTimeString('es-ES', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            const x = padding + i * step;
            ctx.fillText(time, x, height - 5);
        }
    });
}

// Exportar datos
function exportData() {
    if (state.measurements.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    // Crear CSV
    let csv = 'Fecha,Hora,Nivel de Temblor (0-10),Frecuencia (Hz),Amplitud,Interpretación\n';
    
    state.measurements.forEach(m => {
        const date = new Date(m.timestamp);
        const dateStr = date.toLocaleDateString('es-ES');
        const timeStr = date.toLocaleTimeString('es-ES');
        
        csv += `${dateStr},${timeStr},${m.severityLevel.toFixed(2)},${m.dominantFrequency.toFixed(2)},${m.amplitudeRMS.toFixed(3)},"${m.interpretation}"\n`;
    });

    // Estadísticas al final
    const levels = state.measurements.map(m => m.severityLevel);
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    const max = Math.max(...levels);
    const min = Math.min(...levels);

    csv += `\nEstadísticas del día:\n`;
    csv += `Promedio,${avg.toFixed(2)}\n`;
    csv += `Máximo,${max.toFixed(2)}\n`;
    csv += `Mínimo,${min.toFixed(2)}\n`;
    csv += `Total de mediciones,${state.measurements.length}\n`;

    // Copiar al portapapeles
    navigator.clipboard.writeText(csv).then(() => {
        alert('✅ Datos copiados al portapapeles.\n\nPuedes pegarlos en un correo o documento para tu médico.');
    }).catch(err => {
        // Fallback: mostrar en alert
        prompt('Copia estos datos para tu médico:', csv);
    });

    // También ofrecer descarga
    downloadCSV(csv);
}

function downloadCSV(csv) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const date = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `temblor_parkinson_${date}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Instalar como PWA
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredPrompt = e;

    // Mostrar botón de instalación
    const installBtn = document.createElement('button');
    installBtn.className = 'btn btn-secondary';
    installBtn.innerHTML = '📲 Instalar como App';
    installBtn.onclick = installApp;
    
    document.querySelector('.container').insertBefore(
        installBtn, 
        document.querySelector('.container').firstChild
    );
});

function installApp() {
    if (!state.deferredPrompt) return;
    
    state.deferredPrompt.prompt();
    state.deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
            console.log('PWA instalada');
        }
        state.deferredPrompt = null;
    });
}

// Inicialización
function initializeApp() {
    loadMeasurements();
    
    // Verificar soporte
    if (!window.DeviceMotionEvent) {
        dom.status.innerHTML = 
            '⚠️ Tu navegador no soporta el acelerómetro.<br>Prueba con Chrome o Safari.';
        dom.startBtn.disabled = true;
    }

    // Adjuntar eventos
    dom.startBtn.addEventListener('click', startMonitoring);
    dom.exportBtn.addEventListener('click', exportData);
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => switchTab(e, e.currentTarget.dataset.tab));
    });
}

// Prevenir sleep durante monitoreo
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            state.wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.log('Wake Lock no disponible:', err);
    }
}

// Modificar beginMonitoring para usar wake lock
const originalBeginMonitoring = beginMonitoring;
beginMonitoring = function() {
    requestWakeLock();
    dom.startBtn.removeEventListener('click', startMonitoring);
    dom.startBtn.addEventListener('click', stopMonitoring);
    originalBeginMonitoring();
};

// Modificar stopMonitoring para liberar wake lock
const originalStopMonitoring = stopMonitoring;
stopMonitoring = function() {
    if (state.wakeLock) {
        state.wakeLock.release();
        state.wakeLock = null;
    }
    dom.startBtn.removeEventListener('click', stopMonitoring);
    dom.startBtn.addEventListener('click', startMonitoring);
    originalStopMonitoring();
};

// Service Worker para funcionalidad offline
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('Service Worker registrado'))
        .catch(err => console.log('Service Worker error:', err));
}

// Iniciar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initializeApp);

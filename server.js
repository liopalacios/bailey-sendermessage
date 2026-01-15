const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
const axios = require('axios');

let sock = null;
let isConnected = false;
let qrCodeData = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Logger configurado para menos ruido
const logger = pino({ level: 'silent' });

// Crear carpeta para almacenar sesión
const authFolder = path.join(__dirname, 'auth_info');
const AUTH_FOLDER = path.resolve('./auth_info')

if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder);
}

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        // Obtener la última versión de Baileys
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Usando WA v${version.join('.')}, es la última: ${isLatest}`);
        
        sock = makeWASocket({
            version,
            logger,
            auth: state,
            browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
            // Configuración para mejor estabilidad
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCodeData = qr;
                console.log('\n========================================');
                console.log('📱 CÓDIGO QR DISPONIBLE');
                console.log('========================================');
                console.log('Escanea este código QR con WhatsApp:');
                console.log('WhatsApp → Menú (⋮) → Dispositivos vinculados → Vincular un dispositivo\n');
                console.log('QR Code:', qr);
                qrcode.generate(qr, { small: true });
                console.log('========================================\n');
                
                // También puedes guardarlo en un archivo para verlo
                fs.writeFileSync('qr.txt', qr);
                console.log('✅ Código QR guardado en qr.txt\n');
            }
            
            if (connection === 'close') {
                isConnected = false;
                qrCodeData = null;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('❌ Conexión cerrada debido a:', lastDisconnect?.error);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('🚪 Sesión cerrada. Elimina la carpeta auth_info y vuelve a escanear el QR');
                    reconnectAttempts = 0;
                } else if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(`🔄 Intentando reconectar (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(() => connectToWhatsApp(), 3000);
                } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log('❌ Máximo de intentos de reconexión alcanzado');
                    console.log('💡 Solución: Elimina la carpeta auth_info y reinicia el servidor');
                }
            } else if (connection === 'open') {
                console.log('\n✅ ¡CONECTADO EXITOSAMENTE A WHATSAPP!\n');
                isConnected = true;
                qrCodeData = null;
                reconnectAttempts = 0;
            } else if (connection === 'connecting') {
                console.log('🔄 Conectando a WhatsApp...');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Manejar mensajes entrantes (opcional)
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                if (!msg.message || msg.key.fromMe) continue;

                const remoteJid = msg.key.remoteJid;
                const isGroup = remoteJid.endsWith('@g.us');
                const sender = isGroup ? msg.key.participant : remoteJid;

                // Texto plano
                const text =
                    msg.message.conversation ??
                    msg.message.extendedTextMessage?.text ??
                    msg.message.imageMessage?.caption ??
                    msg.message.videoMessage?.caption ??
                    null;

                if (!text) continue;

                console.log(`📨 ${sender}: ${text}`);

                try {
                    // 👉 Enviar mensaje a Python
                    /*const response = await axios.post(
                        'http://localhost:8000/whatsapp/incoming',
                        {
                            text,
                            sender,
                            chat_id: remoteJid,
                            is_group: isGroup,
                            timestamp: Date.now()
                        },
                        { timeout: 30000 }
                    );
                    console.log('🔄 Mensaje enviado a Python, esperando respuesta...');
                    console.log('Respuesta de Python:', response.data);*/
                    // 👉 Si Python devuelve respuesta → enviarla a WhatsApp
                    /*if (response.data?.reply) {
                        console.log(`📤 Enviando respuesta a ${remoteJid}: ${response.data.reply}`);
                        await sock.sendMessage(remoteJid, {
                            text: response.data.reply
                        });
                    }*/

                } catch (error) {
                    console.error('❌ Error comunicando con Python:', error.message);
                }
            }
        });

    } catch (error) {
        console.error('❌ Error al conectar:', error);
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`🔄 Reintentando en 5 segundos (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            setTimeout(() => connectToWhatsApp(), 5000);
        }
    }
}

// Endpoint para obtener estado de conexión
app.get('/status', (req, res) => {
    res.json({
        connected: isConnected,
        hasQR: qrCodeData !== null,
        reconnectAttempts
    });
});

// Endpoint para obtener código QR
app.get('/qr', (req, res) => {
    if (qrCodeData) {
        res.json({ 
            qr: qrCodeData,
            message: 'Escanea este código QR con WhatsApp'
        });
    } else if (isConnected) {
        res.json({ 
            connected: true,
            message: 'Ya está conectado a WhatsApp' 
        });
    } else {
        res.json({ 
            message: 'Esperando código QR... Verifica la consola del servidor'
        });
    }
});

// Endpoint para reiniciar conexión
app.post('/restart', async (req, res) => {
    try {
        console.log('🔄 Reiniciando conexión...');
        if (sock) {
            await sock.logout().catch(() => {})
            sock.end();
            sock = null;
        }
        // 2️⃣ Eliminar carpeta auth_info (sesión)
        if (fs.existsSync(AUTH_FOLDER)) {
            console.log('🧹 Eliminando carpeta auth_info...')
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true })
        }
        reconnectAttempts = 0;
        setTimeout(() => connectToWhatsApp(), 3000);
        res.json({ success: true, message: 'Reiniciando conexión' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para enviar mensaje a un número
app.post('/send-message', async (req, res) => {
    try {
        if (!isConnected) {
            return res.status(400).json({ 
                error: 'WhatsApp no está conectado',
                suggestion: 'Verifica el estado con GET /status'
            });
        }

        const { number, message } = req.body;
        
        if (!number || !message) {
            return res.status(400).json({ 
                error: 'Se requiere número y mensaje',
                example: {
                    number: '51987654321',
                    message: 'Tu mensaje aquí'
                }
            });
        }

        // Formatear número (agregar @s.whatsapp.net)
        let formattedNumber = number.replace(/[^0-9]/g, '');
        formattedNumber = formattedNumber.includes('@s.whatsapp.net') 
            ? formattedNumber 
            : `${formattedNumber}@s.whatsapp.net`;

        console.log(`📤 Enviando mensaje a ${number}...`);
        await sock.sendMessage(formattedNumber, { text: message });
        console.log(`✅ Mensaje enviado a ${number}`);
        
        res.json({ 
            success: true, 
            message: `Mensaje enviado a ${number}`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error al enviar mensaje:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error al enviar mensaje', 
            details: error.message 
        });
    }
});

// Endpoint para enviar mensajes a múltiples números
app.post('/send-bulk', async (req, res) => {
    try {
        if (!isConnected) {
            return res.status(503).json({ 
                status: 'error',
                message: 'WhatsApp no está conectado. Por favor, escanea el QR.',
                details: null 
            });
        }

        const { message, contacts, delay = 1000 } = req.body;
        
        if (!contacts || !Array.isArray(contacts) || !message) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Parámetros requeridos no válidos. Se espera message y contacts (array de objetos).',
                example: {
                    message: 'Hola #NOMBRE#, tu código es 123.',
                    contacts: [{ numero: '51987654321', nombre: 'Juan' }],
                    delay: 1000
                }
            });
        }

        const results = [];
        const totalCount = contacts.length; // Usamos totalCount para el conteo final
        console.log(`📤 Iniciando envío masivo a ${totalCount} contactos...`);
        
        for (let i = 0; i < totalCount; i++) {
            const contact = contacts[i];
            const number = contact.numero;
            // Usar 'Cliente' si el nombre es nulo o vacío, como se definió en Python
            const name = contact.nombre || 'Cliente'; 
            let formattedNumber = ''; 
            try {
                // 2. PERSONALIZACIÓN DEL MENSAJE
                // Reemplazar el placeholder #NOMBRE# con el nombre real del contacto
                // Se usa una expresión regular global (/g) para reemplazar todas las ocurrencias.
                const personalizedMessage = message.replace(/#NOMBRE#/g, name);
                formattedNumber = number.replace(/[^0-9]/g, '');
                formattedNumber = formattedNumber.includes('@s.whatsapp.net') 
                    ? formattedNumber 
                    : `${formattedNumber}@s.whatsapp.net`;

                // 3. ENVIAR MENSAJE PERSONALIZADO
                await sock.sendMessage(formattedNumber, { text: personalizedMessage });
                
                results.push({ 
                    number: contact.numero,
                    success: true, 
                    message: `Mensaje enviado. Nombre usado: ${name}`
                });
                console.log(`✅ [${i + 1}/${contacts.length}] Enviado a ${name} (${number}).`);
                
                // 4. Esperar entre mensajes (Delay)
                if (i < contacts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                console.error(`❌ Error al enviar mensaje a ${number}:`, error.message);
                results.push({ 
                    number: contact.numero, 
                    success: false, 
                    error: error.message 
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        console.log(`✅ Proceso completado: ${successCount}/${contacts.length} exitosos`);
        
        res.json({ 
            success: true,
            total: contacts.length,
            successful: successCount,
            failed: contacts.length - successCount,
            results 
        });
    } catch (error) {
        console.error('❌ Error al enviar mensajes:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error al enviar mensajes', 
            details: error.message 
        });
    }
});

// Endpoint para enviar mensajes individuales
app.post('/send', async (req, res) => {
    try {
        if (!isConnected) {
            return res.status(503).json({ 
                status: 'error',
                message: 'WhatsApp no está conectado. Por favor, escanea el QR.',
                details: null 
            });
        }

        const { message, contacto } = req.body;
        
        if (!contacto?.numero || !message) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Parámetros requeridos no válidos. Se espera message y contacto (objeto con numero y nombre).',
                example: {
                    message: 'Hola #NOMBRE#, tu código es 123.',
                    contacto: { numero: '987654321', nombre: 'Juan' }
                }
            });
        }

        
        
        console.log(`📤 Iniciando envío a ${contacto.numero} ...`);
        
        // 2. PERSONALIZACIÓN DEL MENSAJE
        // Reemplazar el placeholder #NOMBRE# con el nombre real del contacto
        // Se usa una expresión regular global (/g) para reemplazar todas las ocurrencias.
        const name = contacto.nombre || 'Cliente';
        const personalizedMessage = message.replace(/#NOMBRE#/g, name);
        
        
        let formattedNumber = contacto.numero.replace(/\D/g, '');

        if (formattedNumber.length === 9) {
            formattedNumber = '51' + formattedNumber;
        }
            if (!/^51\d{9}$/.test(formattedNumber)) {
            return res.status(400).json({
                status: 'error',
                message: 'Número inválido después de validación'
            });
        }
        formattedNumber = formattedNumber.includes('@s.whatsapp.net') 
            ? formattedNumber 
            : `${formattedNumber}@s.whatsapp.net`;

        if (!formattedNumber) {
            return res.status(400).json({
                status: 'error',
                message: 'Número inválido después de validación'
            });
        }
        // 3. ENVIAR MENSAJE PERSONALIZADO
        await sock.sendMessage(formattedNumber, { text: personalizedMessage });
        
        console.log(`✅ [${now()}] Mensaje enviado a ${name} (${contacto.numero})`);

        return res.json({
            success: true,
            number: contacto.numero,
            nameUsed: name,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`❌ Error al enviar mensaje a ${req.body?.contacto?.numero}:`, error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al enviar mensaje',
            details: error.message
        });
    }
        
});
function now() {
    return new Date().toLocaleTimeString('es-PE', {
        hour12: false
    });
}
// Endpoint para cerrar sesión y limpiar
app.post('/logout', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
            isConnected = false;
            qrCodeData = null;
            
            // Eliminar carpeta de autenticación
            if (fs.existsSync(authFolder)) {
                fs.rmSync(authFolder, { recursive: true, force: true });
                console.log('🗑️  Sesión eliminada');
            }
            
            res.json({ 
                success: true, 
                message: 'Sesión cerrada. Reinicia el servidor para conectar nuevamente.' 
            });
        } else {
            res.json({ message: 'No había conexión activa' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint de salud
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        connected: isConnected,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🚀 SERVIDOR WHATSAPP BOT INICIADO');
    console.log('========================================');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log('========================================\n');
    
    console.log('📋 Endpoints disponibles:');
    console.log(`  GET  /status       - Ver estado de conexión`);
    console.log(`  GET  /qr           - Obtener código QR`);
    console.log(`  POST /send-message - Enviar mensaje individual`);
    console.log(`  POST /send-bulk    - Enviar mensajes masivos`);
    console.log(`  POST /restart      - Reiniciar conexión`);
    console.log(`  POST /logout       - Cerrar sesión`);
    console.log(`  GET  /health       - Estado del servidor\n`);
    
    connectToWhatsApp();
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Error no manejado:', err);
});
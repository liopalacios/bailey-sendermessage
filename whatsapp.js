const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// --- Variables de Estado Compartidas ---
let sock = null;
let isConnected = false;
let qrCodeData = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Logger configurado para menos ruido
const logger = pino({ level: 'silent' });

// Crear carpeta para almacenar sesión
const authFolder = path.join(__dirname, 'auth_info');
if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder);
}

// --- Funciones de Lógica de Conexión ---

/**
 * Función principal para conectar a WhatsApp.
 */
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Usando WA v${version.join('.')}, es la última: ${isLatest}`);
        
        sock = makeWASocket({
            version,
            logger,
            auth: state,
            browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
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
                qrcode.generate(qr, { small: true });
                fs.writeFileSync('qr.txt', qr);
                console.log('✅ Código QR guardado en qr.txt\n');
            }
            
            if (connection === 'close') {
                isConnected = false;
                qrCodeData = null;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('❌ Conexión cerrada debido a:', lastDisconnect?.error?.message);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('🚪 Sesión cerrada. Elimina la carpeta auth_info y vuelve a escanear el QR');
                    reconnectAttempts = 0;
                } else if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(`🔄 Intentando reconectar (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(() => connectToWhatsApp(), 3000);
                } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log('❌ Máximo de intentos de reconexión alcanzado');
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
            if (type === 'notify') {
                for (const msg of messages) {
                    if (!msg.key.fromMe && msg.message) {
                        console.log('📨 Mensaje recibido de:', msg.key.remoteJid);
                    }
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

/**
 * Función para cerrar la sesión actual y limpiar archivos.
 */
async function logout() {
    if (sock) {
        await sock.logout();
        
        // Eliminar carpeta de autenticación
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
            console.log('🗑️  Sesión eliminada');
        }
    }
    isConnected = false;
    qrCodeData = null;
    reconnectAttempts = 0;
}

/**
 * Función para enviar mensajes (Lógica compartida con send-message y send-bulk).
 * @param {string} number - Número de teléfono.
 * @param {string} message - Mensaje a enviar.
 */
async function sendMessage(number, message) {
    if (!sock || !isConnected) {
        throw new Error('WhatsApp no está conectado');
    }
    
    let formattedNumber = number.replace(/[^0-9]/g, '');
    formattedNumber = formattedNumber.includes('@s.whatsapp.net') 
        ? formattedNumber 
        : `${formattedNumber}@s.whatsapp.net`;

    await sock.sendMessage(formattedNumber, { text: message });
    return { success: true, message: `Mensaje enviado a ${number}` };
}

// Exportar las funciones y variables necesarias para el archivo principal (endpoints)
module.exports = {
    connectToWhatsApp,
    logout,
    sendMessage,
    getSock: () => sock,
    getIsConnected: () => isConnected,
    getQrCodeData: () => qrCodeData,
    getReconnectAttempts: () => reconnectAttempts,
};
// AGREGAR ESTO AL server-new.js después de los otros endpoints

// Instalar primero: npm install qrcode

const QRCode = require('qrcode');

// Endpoint para obtener QR como imagen PNG
app.get('/qr-image', async (req, res) => {
    try {
        if (qrCodeData) {
            // Generar imagen QR
            const qrImage = await QRCode.toDataURL(qrCodeData, {
                width: 400,
                margin: 2
            });
            
            // Enviar HTML con la imagen
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>WhatsApp QR Code</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            min-height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .container {
                            background: white;
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                            text-align: center;
                        }
                        h1 { color: #25D366; margin-bottom: 20px; }
                        img { margin: 20px 0; border-radius: 10px; }
                        .instructions {
                            text-align: left;
                            background: #f5f5f5;
                            padding: 20px;
                            border-radius: 10px;
                            margin-top: 20px;
                        }
                        .refresh {
                            margin-top: 20px;
                            padding: 12px 30px;
                            background: #25D366;
                            color: white;
                            border: none;
                            border-radius: 25px;
                            cursor: pointer;
                            font-size: 16px;
                        }
                        .refresh:hover { background: #128C7E; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>📱 Conectar WhatsApp</h1>
                        <img src="${qrImage}" alt="QR Code">
                        <div class="instructions">
                            <strong>Instrucciones:</strong>
                            <ol>
                                <li>Abre WhatsApp en tu teléfono</li>
                                <li>Ve a Menú (⋮) → Dispositivos vinculados</li>
                                <li>Toca "Vincular un dispositivo"</li>
                                <li>Escanea este código QR</li>
                            </ol>
                        </div>
                        <button class="refresh" onclick="location.reload()">🔄 Actualizar</button>
                    </div>
                    <script>
                        // Auto-actualizar cada 5 segundos
                        setTimeout(() => location.reload(), 5000);
                    </script>
                </body>
                </html>
            `);
        } else if (isConnected) {
            res.send(`
                <div style="text-align:center;padding:50px;font-family:Arial;">
                    <h1 style="color:#25D366;">✅ Ya estás conectado!</h1>
                    <p>WhatsApp está funcionando correctamente.</p>
                </div>
            `);
        } else {
            res.send(`
                <div style="text-align:center;padding:50px;font-family:Arial;">
                    <h2>⏳ Esperando código QR...</h2>
                    <p>Generando conexión, por favor espera...</p>
                    <script>setTimeout(() => location.reload(), 3000);</script>
                </div>
            `);
        }
    } catch (error) {
        res.status(500).send(`Error: ${error.message}`);
    }
});
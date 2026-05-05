const https = require('https');
const crypto = require('crypto');

const PUBLIC_KEY = "pk_0zE98vjAJ0_-2am1aa06NU4WaRVND405Y3ZDTpKbPdpYwXv_";
const SECRET_KEY = "sk_HwrBVQO1MezVbJfaqdImeEmMCiCNRk37UJgVee_0LIHQSWph";
const PIXEL_ID = "3059682304380413";
const ACCESS_TOKEN = "EAFeZAMItwIDMBRRwmKcrSA5pOkqlRH9L9Ic0SCzRbpiwX9BPdAjkhDxq4tn2v1zbD9vDdVSZBXiZBqbNK3x57vdzu60HUppISm4uFnwsA6KwYXs3Me6oxr8nxg5MVtyZBUMcTsWTTFQ9Nv0twR7h0x0H3STCSoaxwl9VyZAZBb9kDAou8wUKn95i8RpZANIgwZDZD";

let stats = { visits: 0, checkouts: 0, sales: 0, revenue: 0, orders: [] };

function hashData(data) {
    if (!data) return "";
    return crypto.createHash('sha256').update(String(data).trim().toLowerCase()).digest('hex');
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.query;

    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    try {
        if (action === 'trackVisit') {
            stats.visits++;
            return res.status(200).json({ status: 'ok' });
        }

        if (action === 'trackCheckout') {
            stats.checkouts++;
            return res.status(200).json({ status: 'ok' });
        }

        if (action === 'gerarPix') {
            const { nome, email, phone, document, valor, kitName, address } = body;

            const valorFinal = Math.round(parseFloat(valor || 0));
            const cleanCpf = String(document || "").replace(/\D/g, '');
            let cleanPhone = String(phone || "").replace(/\D/g, '');
            if (cleanPhone.length > 11) cleanPhone = cleanPhone.slice(-11);

            const auth = Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64');
            const externalRef = `panini_${Date.now()}`;

            const streetPayload = JSON.stringify({
                amount: valorFinal,
                paymentMethod: "pix",
                externalRef: externalRef,
                customer: {
                    name: String(nome || "Cliente").trim(),
                    email: String(email || "cliente@email.com").trim().toLowerCase(),
                    phone: cleanPhone || "11999999999",
                    document: { number: cleanCpf || "00000000000", type: "cpf" }
                },
                items: [{ title: `Panini - ${kitName || "Kit"}`, unitPrice: valorFinal, quantity: 1, tangible: true }],
                pix: { expiresInDays: 1 }
            });

            const options = {
                hostname: 'api.streetpayments.com.br',
                path: '/v1/sales',
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(streetPayload)
                }
            };

            const streetResponse = await new Promise((resolve, reject) => {
                const sReq = https.request(options, (sRes) => {
                    let sData = '';
                    sRes.on('data', (chunk) => sData += chunk);
                    sRes.on('end', () => {
                        try {
                            resolve({ status: sRes.statusCode, data: JSON.parse(sData) });
                        } catch(e) {
                            resolve({ status: sRes.statusCode, data: { message: sData } });
                        }
                    });
                });
                sReq.on('error', (e) => reject(e));
                sReq.write(streetPayload);
                sReq.end();
            });

            if (streetResponse.status >= 200 && streetResponse.status < 300 && streetResponse.data.id) {
                const data = streetResponse.data;
                const newOrder = {
                    id: data.id,
                    externalRef: externalRef,
                    date: new Date().toLocaleString('pt-BR'),
                    nome, email, customer_phone: cleanPhone,
                    product: kitName, amount: (valorFinal / 100).toFixed(2),
                    address, status: 'Aguardando PIX'
                };
                stats.orders.unshift(newOrder);
                return res.status(200).json({ status: 'success', id: data.id, pix_copia_e_cola: data.pix.qrcode });
            } else {
                return res.status(400).json({ 
                    status: 'error', 
                    error: streetResponse.data.message || streetResponse.data.error || 'Erro no gateway' 
                });
            }
        }

        if (action === 'adminData') {
            if (body.password !== 'criss123') return res.status(401).json({ error: 'Senha incorreta' });
            return res.status(200).json(stats);
        }

        return res.status(404).json({ error: 'Ação não encontrada' });

    } catch (error) {
        return res.status(200).json({ 
            status: 'error', 
            error: "Erro Interno: " + error.message
        });
    }
};

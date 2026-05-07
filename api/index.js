const https = require('https');
const crypto = require('crypto');

const SECRET_KEY = "TNzsCSraqbnscwl7O3XUoIi_5oDHPURug6whDwhHexI";
const PIXEL_ID = "3059682304380413";
const ACCESS_TOKEN = "EAFeZAMItwIDMBRRwmKcrSA5pOkqlRH9L9Ic0SCzRbpiwX9BPdAjkhDxq4tn2v1zbD9vDdVSZBXiZBqbNK3x57vdzu60HUppISm4uFnwsA6KwYXs3Me6oxr8nxg5MVtyZBUMcTsWTTFQ9Nv0twR7h0x0H3STCSoaxwl9VyZAZBb9kDAou8wUKn95i8RpZANIgwZDZD";
const TEST_CODE = "TEST46175";

let stats = { visits: 0, checkouts: 0, sales: 0, revenue: 0, orders: [] };

function hashData(data) {
    if (!data) return "";
    return crypto.createHash('sha256').update(String(data).trim().toLowerCase()).digest('hex');
}

async function sendMetaPurchase(order) {
    try {
        const payload = JSON.stringify({
            data: [{
                event_name: "Purchase",
                event_time: Math.floor(Date.now() / 1000),
                action_source: "website",
                test_event_code: TEST_CODE,
                user_data: { em: [hashData(order.email)], ph: [hashData(order.customer_phone)] },
                custom_data: { value: parseFloat(order.amount), currency: "BRL", content_name: order.product }
            }]
        });
        const options = {
            hostname: 'graph.facebook.com',
            path: `/v17.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };
        const req = https.request(options); req.write(payload); req.end();
    } catch (e) {}
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.query;
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }

    try {
        if (action === 'trackVisit') { stats.visits++; return res.status(200).json({ status: 'ok' }); }
        if (action === 'trackCheckout') { stats.checkouts++; return res.status(200).json({ status: 'ok' }); }

        if (action === 'gerarPix') {
            const { nome, email, phone, document, valor, kitName, address } = body;
            const valorFinal = Math.round(parseFloat(valor || 0));
            const externalRef = `panini_${Date.now()}`;

            // ESTRUTURA 100% FIEL À DOCUMENTAÇÃO V1
            const streetPayload = JSON.stringify({
                amount: valorFinal,
                currency: "BRL",
                method: "PIX",
                description: `Pedido Panini - ${kitName || "Kit"}`,
                externalRef: externalRef,
                payer: { 
                    name: String(nome || "Cliente").trim(), 
                    email: String(email || "cliente@email.com").trim().toLowerCase(), 
                    phone: String(phone || "11999999999").replace(/\D/g, ''), 
                    taxId: String(document || "00000000000").replace(/\D/g, '') 
                },
                items: [{ 
                    quantity: 1, 
                    name: String(kitName || "Kit Panini").trim(), 
                    price: valorFinal, 
                    type: "PHYSICAL" 
                }],
                delivery: {
                    fee: 0,
                    address: {
                        country: "BR",
                        state: String(address.state || "SP").trim().toUpperCase(),
                        city: String(address.city || "Cidade").trim(),
                        district: String(address.district || "Bairro").trim(),
                        street: String(address.street || "Rua").trim(),
                        number: String(address.streetNumber || "SN").trim(),
                        complement: String(address.complement || "").trim(),
                        zipCode: String(address.zipCode || "00000000").replace(/\D/g, '')
                    }
                },
                pix: { expiresInDays: 1 }
            });

            const options = {
                hostname: 'api.streetpays.com.br',
                path: '/v1/payment',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${SECRET_KEY}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(streetPayload)
                }
            };

            const streetResponse = await new Promise((resolve) => {
                const sReq = https.request(options, (sRes) => {
                    let sData = '';
                    sRes.on('data', (chunk) => sData += chunk);
                    sRes.on('end', () => {
                        try { resolve({ status: sRes.statusCode, data: JSON.parse(sData) }); }
                        catch(e) { resolve({ status: sRes.statusCode, data: { message: sData } }); }
                    });
                });
                sReq.on('error', (e) => resolve({ status: 500, data: { message: e.message } }));
                sReq.write(streetPayload);
                sReq.end();
            });

            if (streetResponse.status >= 200 && streetResponse.status < 300) {
                const rData = streetResponse.data;
                // Busca profunda pelo código do PIX
                const pixCode = rData.data?.copypaste || rData.copypaste || rData.pixCopiaECola || "";
                
                if (pixCode) {
                    const newOrder = {
                        id: rData.id,
                        nome, email, customer_phone: phone,
                        product: kitName, amount: (valorFinal / 100).toFixed(2),
                        status: 'Aguardando PIX'
                    };
                    stats.orders.unshift(newOrder);
                    return res.status(200).json({ status: 'success', pix_copia_e_cola: pixCode });
                }
            }

            // MODO DIAGNÓSTICO REAL
            const errorInfo = streetResponse.data.message || streetResponse.data.error || JSON.stringify(streetResponse.data);
            return res.status(400).json({ status: 'error', error: "Erro StreetPay: " + errorInfo });
        }

        if (action === 'webhook') {
            const { id, status, externalRef } = body;
            if (status === 'paid' || status === 'confirmed') {
                const order = stats.orders.find(o => o.id === id || o.externalRef === externalRef);
                if (order) {
                    order.status = 'Pago';
                    stats.sales++;
                    stats.revenue += parseFloat(order.amount);
                    sendMetaPurchase(order);
                }
            }
            return res.status(200).json({ received: true });
        }

        if (action === 'adminData') {
            if (body.password !== 'criss123') return res.status(401).json({ error: 'Senha incorreta' });
            return res.status(200).json(stats);
        }
        return res.status(404).end();
    } catch (e) { return res.status(500).json({ status: 'error', error: e.message }); }
};

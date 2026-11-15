app.post("/rota-recebimento-mercado-pago-gerson", async (req: any, res: any) => {
    try {
        console.log("Headers:", req.headers);
        console.log("Query:", req.query);
        console.log("Body:", req.body);

        // 1. Captura o ID independente do formato enviado pelo Mercado Pago
        const paymentId = req.body?.data?.id || req.query?.id || req.query?.['data.id'];

        // 2. Trata a chamada de teste do painel do Mercado Pago
        if (String(paymentId) === "123456") {
            console.log("Chamada de Teste recebida com sucesso!");
            return res.status(200).json({ status: "ok" });
        }

        // 3. Ignora eventos que não sejam de pagamento ou que venham sem ID
        if (!paymentId) {
            return res.status(200).json({ status: "ignorado, sem paymentId" });
        }

        // 4. Responde 200 imediatamente ao Mercado Pago para evitar timeout ou retentativas
        res.status(200).json({ status: "recebido" });

        // 5. Consulta os detalhes do pagamento usando await
        const url = `https://api.mercadopago.com/v1/payments/${paymentId}`;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${mercadoPagoToken}` }
        });

        if (response.data.status !== "approved") {
            console.log("Pagamento não aprovado. Status:", response.data.status);
            return;
        }

        console.log('store_id:', response.data.store_id);
        console.log('transaction_amount:', response.data.transaction_amount);

        // Creditar de acordo com o store_id
        if (String(response.data.store_id) === '68826545') {
            if (tempoOffline(ultimoAcessoMaquina01) >= 10) {
                console.log("Efetuando estorno - Máquina Offline!");
                await estornar(String(paymentId), mercadoPagoToken!, "Máquina Offline");
            } else {
                console.log("Creditando pix na máquina 1. store_id(68826545)");
                valorDoPixMaquina01 = response.data.transaction_amount;

                switch (response.data.transaction_amount) {
                    case 2.5:
                        compartimentoMaquina01 = "01";
                        break;
                    case 3.5:
                        compartimentoMaquina01 = "02";
                        break;
                    case 10:
                        compartimentoMaquina01 = "03";
                        break;
                    case 12.99:
                        compartimentoMaquina01 = "04";
                        break;
                    // Adicione os demais cases aqui
                }
            }
        }
    } catch (error: any) {
        console.error("Erro ao processar webhook:", error?.response?.data || error.message);
        // Só envia erro se a resposta ainda não tiver sido enviada ao Mercado Pago
        if (!res.headersSent) {
            return res.status(200).json({ status: "erro interno tratado" });
        }
    }
});


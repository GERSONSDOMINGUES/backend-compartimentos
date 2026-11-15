app.post("/rota-recebimento-mercado-pago-gerson", async (req: any, res: any) => {
    try {
        console.log("Query:", req.query);
        console.log("Body:", req.body);

        // Captura o ID de forma compatível com qualquer versão do TS
        let paymentId = "";
        if (req.body && req.body.data && req.body.data.id) {
            paymentId = String(req.body.data.id);
        } else if (req.query && req.query.id) {
            paymentId = String(req.query.id);
        } else if (req.query && req.query["data.id"]) {
            paymentId = String(req.query["data.id"]);
        }

        // Trata o teste do Mercado Pago
        if (paymentId === "123456") {
            console.log("Chamada de Teste recebida do Mercado Pago!");
            return res.status(200).json({ status: "ok" });
        }

        if (!paymentId) {
            return res.status(200).json({ status: "sem id" });
        }

        // Responde rápido para o Mercado Pago
        res.status(200).json({ status: "recebido" });

        const url = "https://mercadopago.com" + paymentId;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${mercadoPagoToken}` }
        });

        if (response.data.status !== "approved") {
            console.log("Pagamento não aprovado!");
            return;
        }

        console.log("store_id:", response.data.store_id);
        console.log("transaction_amount:", response.data.transaction_amount);

        if (String(response.data.store_id) === "68826545") {
            if (tempoOffline(ultimoAcessoMaquina01) >= 10) {
                console.log("Efetuando estorno - Máquina Offline!");
                await estornar(paymentId, mercadoPagoToken!, "Máquina Offline");
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
                    // MANTENHA AQUI OS SEUS OUTROS CASES ORIGINAIS
                }
            }
        }
    } catch (error) {
        console.error("Erro na rota Mercado Pago:", error);
        if (!res.headersSent) {
            return res.status(200).json({ status: "erro tratado" });
        }
    }
});

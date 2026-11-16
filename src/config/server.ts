import cors from 'cors';
import express from 'express';
require('dotenv').config();
const dated = require('date-and-time');
import { parseISO } from 'date-fns';
import axios from 'axios';
import { Console } from 'console';

// Tokens de acesso
var mercadoPagoToken = process.env.MP_TOKEN;

const PORT: string | number = process.env.PORT || 5001;

const app = express();

app.use(cors());
app.use(express.json());

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

// Converte PIX em pulsos. Ex: 5,39 retorna "0005"
function converterPixRecebido(valorPix: number) {
    var valorAux = 0;
    var ticket = 1; // caso o ingresso para uma jogada custe 2 reais, altere aqui p/ 2
    if (valorPix > 0 && valorPix >= ticket) {
        valorAux = valorPix;
        valorPix = 0;
        var creditos = valorAux / ticket;
        creditos = Math.floor(creditos);
        var pulsos = creditos * ticket;
        var pulsosFormatados = ("0000" + pulsos).slice(-4);
        return pulsosFormatados;
    } else {
        return "0000";
    }
}

// Retorna em segundos o tempo desde a última consulta efetuada em uma máquina
function tempoOffline(data2: Date): number {
    var data1 = new Date();
    if (!(data1 instanceof Date) || !(data2 instanceof Date)) {
        throw new Error('Datas inválidas');
    }
    const diferencaEmSegundos = Math.abs((data2.getTime() - data1.getTime()) / 1000);
    return diferencaEmSegundos;
}

function gerarNumeroAleatorio(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

let numTentativasEstorno = 1;
let idempotencyKeyAnterior = "";

function gerarChaveIdempotente() {
    const caracteres = 'b135e1c3d62d0a4e5503380aee2fac5f5fc79d4cdbb9968dbd443378c0ec7736';
    let chave = '';
    for (let i = 0; i < 32; i++) {
        chave += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return chave;
}

function esconderString(string: string) {
    const tamanho = string.length;
    let resultado = '';
    for (let i = 0; i < tamanho - 3; i++) {
        resultado += '*';
    }
    resultado += string.substring(tamanho - 3, tamanho);
    return resultado;
}

async function estornar(id: string, token: string, motivoEstorno: string, tamanhoChave = 32) {
    const url = `https://api.mercadopago.com/v1/payments/${id}/refunds`;

    try {
        console.log('********* estornando *****************');
        console.log(`********* Tentativa nª ${numTentativasEstorno} *****************`);
        console.log(id);
        console.log('********* token *****************');
        console.log(esconderString(token));

        let idempotencyKey = gerarChaveIdempotente();

        const response = await axios.post(url, {}, {
            headers: {
                'X-Idempotency-Key': idempotencyKey,
                'Authorization': `Bearer ${token}`
            }
        });

        console.log(response.data);
        console.log("Estorno da operação: " + id + " efetuado com sucesso!");
        numTentativasEstorno = 1;

        idempotencyKeyAnterior = response.headers['x-idempotency-key'];

        return response.data;

    } catch (error) {
        console.log("Houve um erro ao tentar efetuar o estorno da operação: " + id);
        console.log("Detalhes do erro: " + error);

        numTentativasEstorno++;

        if (numTentativasEstorno < 20) {
            await estornar(id, token, motivoEstorno, tamanhoChave);
        } else {
            console.log("Após 20 tentativas não conseguimos efetuar o estorno, VERIFIQUE O TOKEN DO CLIENTE!!");
            numTentativasEstorno = 1;
        }
    }
}

// ============================================================
// VARIÁVEIS DE CONTROLE
// ============================================================

var valorDoPixMaquina01 = 0;
var ultimoAcessoMaquina01 = new Date('2023-10-20T17:30:10');
var compartimentoMaquina01 = "00";

// ============================================================
// ROTAS DE CONSULTA (a ESP32 chama essa rota)
// ============================================================

app.get("/consulta-maquina01", async (req, res) => {
    var pulsosFormatados = converterPixRecebido(valorDoPixMaquina01);

    valorDoPixMaquina01 = 0;
    ultimoAcessoMaquina01 = new Date();

    const retornoFinal = "00" + compartimentoMaquina01;
    compartimentoMaquina01 = "00";

    if (pulsosFormatados != "0000") {
        return res.status(200).json({ "retorno": retornoFinal });
    } else {
        return res.status(200).json({ "retorno": "0000" });
    }
});

// ============================================================
// ROTAS DE RECEBIMENTO
// ============================================================

// Rota de teste manual (você pode chamar pelo navegador para simular um PIX)
app.get("/rota-recebimento-teste", async (req: any, res: any) => {
    try {
        console.log("Novo pix detectado (teste manual):");

        const valor = req.query.valor;
        const compartimento = req.query.compartimento;

        if (!valor || !compartimento) {
            return res.status(400).json({ error: "Parâmetros 'valor' e 'compartimento' são obrigatórios." });
        }

        valorDoPixMaquina01 = valor;
        compartimentoMaquina01 = compartimento;

        console.log("Valor recebido:", valorDoPixMaquina01);
        console.log("Compartimento:", compartimentoMaquina01);

        return res.status(200).json({ mensagem: "ok" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Erro interno: " + error });
    }
});

// ============================================================
// WEBHOOK DO MERCADO PAGO (CORRIGIDO)
// ============================================================

app.post("/rota-recebimento-mercado-pago-gerson", async (req: any, res: any) => {
    // O Mercado Pago espera uma resposta 200/201 rápida.
    // Sempre respondemos 200 no final, mesmo em caso de erro interno.

    try {
        console.log("=========================================");
        console.log("Notificação recebida do Mercado Pago");
        console.log("Query:", req.query);
        console.log("Body:", req.body);

        // O ID do pagamento pode vir em diferentes lugares dependendo do tipo de notificação:
        // - req.body.data.id  (padrão moderno)
        // - req.query.id      (webhooks antigos / IPN)
        const paymentId =
            (req.body && req.body.data && req.body.data.id) ||
            req.query.id ||
            null;

        // ---- CASO DE TESTE DO MERCADO PAGO ----
        // Quando você clica em "Simular notificação" no painel, ele envia id=123456
        if (paymentId === "123456") {
            console.log("✅ Teste de webhook do Mercado Pago recebido com sucesso (id=123456).");
            return res.status(200).json({ "status": "ok", "message": "teste recebido" });
        }

        if (!paymentId) {
            console.log("⚠️ Notificação sem ID de pagamento. Ignorando.");
            return res.status(200).json({ "status": "ok", "message": "sem id" });
        }

        console.log("ID do Pagamento:", paymentId);

        const url = `https://api.mercadopago.com/v1/payments/${paymentId}`;

        // ---- CONSULTA À API DO MERCADO PAGO ----
        try {
            const response = await axios.get(url, {
                headers: { Authorization: `Bearer ${mercadoPagoToken}` }
            });

            console.log("Status do pagamento:", response.data.status);
            console.log("store_id:", response.data.store_id);
            console.log("transaction_amount:", response.data.transaction_amount);

            if (response.data.status !== "approved") {
                console.log("Pagamento NÃO aprovado. Ignorando crédito.");
                return res.status(200).json({ "status": "ok", "message": "não aprovado" });
            }

            // ---- CRÉDITO POR MÁQUINA ----
            if (response.data.store_id == '83220809') {
                if (tempoOffline(ultimoAcessoMaquina01) >= 10) {
                    console.log("Efetuando estorno - Máquina Offline!");
                    await estornar(paymentId, mercadoPagoToken!, "Máquina Offline");
                } else {
                    console.log("Creditando pix na máquina 1. store_id(83220809)");
                    valorDoPixMaquina01 = response.data.transaction_amount;

                    if (response.data.transaction_amount) {
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
                            default:
                                compartimentoMaquina01 = "00";
                                await estornar(paymentId, mercadoPagoToken!, "Valor Inválido");
                                console.warn("Valor de transação não mapeado:", response.data.transaction_amount);
                        }
                        console.log("Compartimento definido:", compartimentoMaquina01);
                    }
                }
            } else {
                console.log("store_id não reconhecido. Nenhuma máquina creditada.");
            }

        } catch (apiError: any) {
            // Se a chamada à API do Mercado Pago falhar, NÃO retornamos erro para o MP.
            console.error("Erro ao consultar API do Mercado Pago:", apiError.message);
            if (apiError.response) {
                console.error("Status:", apiError.response.status);
                console.error("Data:", apiError.response.data);
            }
        }

    } catch (error) {
        console.error("Erro inesperado no webhook:", error);
    }

    // SEMPRE retorna 200 para o Mercado Pago parar de reenviar
    return res.status(200).json({ "mensagem": "ok" });
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

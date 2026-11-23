// Educação → Orçamento familiar: the social-class test (Critério Brasil 2026, ABEP, valid from
// 05/02/2026: points table, cut-offs, class sizes and average household income from PNADC 2025),
// and a reference budget per class with the expense categories the user keeps in his own finance app.
// The budget split was written by Claude in Nov/2026 as general guidance, not personal advice.
(() => {
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = v => "R$ " + Math.round(v).toLocaleString("pt-BR");
const KEY = "radar.orcamento";

// Critério Brasil 2026: points for 0, 1, 2, 3, 4+ of each item.
const ITENS = [
  { k: "auto", p: "Automóveis de passeio, só para uso particular", pts: [0, 4, 8, 10, 11], dica: "Não conte táxi, van, pick-up de frete nem carro usado também para trabalhar." },
  { k: "gel", p: "Geladeiras", pts: [0, 6, 10, 12, 13], dica: "De uma, duas ou três portas contam igual. Freezer sozinho não conta." },
  { k: "pc", p: "Computadores (de mesa, notebook ou netbook)", pts: [0, 6, 11, 13, 15], dica: "Tablet e celular não contam, nem computador da empresa." },
  { k: "ban", p: "Banheiros", pts: [0, 9, 15, 19, 20], dica: "Todo cômodo com vaso sanitário: lavabos, suítes, o de empregada e os de fora da casa. Banheiro coletivo não conta." },
  { k: "louca", p: "Lava-louças", pts: [0, 5, 5, 5, 5] },
  { k: "roupa", p: "Máquinas de lavar roupa", pts: [0, 6, 6, 6, 6], dica: "Tanquinho não conta." },
  { k: "micro", p: "Micro-ondas", pts: [0, 7, 7, 7, 7], dica: "Vale também o forno de dupla função (micro-ondas e elétrico)." },
  { k: "dom", p: "Empregados domésticos mensalistas", pts: [0, 5, 5, 5, 5], dica: "Só quem trabalha na casa pelo menos 5 dias por semana: inclui babá, motorista, cozinheira e cuidador. Diarista não conta." },
];
const ESTUDO = [["Sem instrução", 0], ["Fundamental incompleto", 3], ["Fundamental completo", 4], ["Médio incompleto", 5], ["Médio completo", 6], ["Superior incompleto", 6], ["Superior completo", 8]];
// cut-off (minimum points), average household income per month (PNADC 2025), share of homes 2026
const CLASSES = [
  { c: "A", min: 73, renda: 28331.26, br: 3.6, sul: 4.9, poa: 5.6 },
  { c: "B1", min: 66, renda: 13636.18, br: 4.9, sul: 6.7, poa: 6.3 },
  { c: "B2", min: 55, renda: 7874.72, br: 15.1, sul: 20.3, poa: 19.4 },
  { c: "C1", min: 46, renda: 4526.88, br: 21.2, sul: 28.6, poa: 29.0 },
  { c: "C2", min: 35, renda: 2648.30, br: 28.1, sul: 27.9, poa: 28.1 },
  { c: "DE", min: 0, renda: 1177.55, br: 27.1, sul: 11.6, poa: 11.6 },
];
const classeDe = pts => CLASSES.find(x => pts >= x.min);
const faixa = x => { const i = CLASSES.indexOf(x); return i === 0 ? `${x.min} a 100 pontos` : `${x.min} a ${CLASSES[i - 1].min - 1} pontos`; };

// Reference budget, % of the family's monthly income, in the order A, B1, B2, C1, C2, DE.
const ORC = [
  ["Moradia", [20, 24, 26, 28, 30, 32], "Aluguel ou prestação do financiamento da casa, condomínio, luz, água, gás, internet e IPTU. O limite saudável é perto de 30% da renda."],
  ["Alimentação", [7, 11, 15, 20, 26, 32], "Mercado, feira e açougue. Pesa mais quanto menor a renda."],
  ["Restaurantes", [4, 4, 4, 3, 2, 1], "Comer fora, delivery e lanches."],
  ["Transporte", [8, 10, 12, 12, 12, 11], "Ônibus, aplicativo, combustível, manutenção, IPVA e estacionamento. A prestação do carro financiado também entra aqui: se ela não couber junto com o resto, o carro está caro para a renda."],
  ["Saúde", [6, 7, 7, 5, 3, 2], "Plano de saúde, consultas, exames e dentista. Nas classes C2 e DE o SUS cobre a maior parte."],
  ["Farmácia", [1, 1, 2, 2, 3, 4], "Remédios e itens de higiene."],
  ["Educação", [8, 8, 7, 5, 4, 3], "Escola, faculdade, cursos, material e livros. É o gasto que mais ajuda a subir de classe."],
  ["Seguros", [3, 3, 3, 2, 1, 0], "Seguro de vida, do carro e da casa. Cresce quando há patrimônio e dependentes para proteger."],
  ["Previdência", [23, 19, 15, 10, 8, 5], "A parte da prosperidade: separe no dia do pagamento, antes de gastar. Primeiro uma reserva de emergência (6 meses de gastos), depois previdência e investimentos. Quem tem dívidas usa esta parte para quitá-las, começando pelos juros mais altos."],
  ["Lazer", [6, 6, 5, 7, 6, 5], "Passeios, viagens, streaming, academia e hobbies. Ter lazer planejado ajuda a manter o orçamento."],
  ["Beleza", [2, 2, 2, 2, 2, 2], "Cabelo, estética e cosméticos. Como não há categoria de roupas, elas podem entrar aqui."],
  ["Presentes", [1, 1, 1, 2, 2, 2], "Aniversários, Natal e doações."],
  ["Pet", [1, 1, 1, 2, 1, 1], "Ração, veterinário e banho. Zero para quem não tem animal: a sobra vai para Previdência."],
  ["Empregado doméstico", [9, 3, 0, 0, 0, 0], "Mensalista com carteira custa bem mais que o salário. Com o mínimo nacional de 2026 (R$ 1.621): + 20% de encargos todo mês (INSS 8%, FGTS 8%, multa do FGTS 3,2% e seguro 0,8%) + a reserva para 13º e férias com 1/3 = cerca de R$ 2.320 por mês, e uns R$ 2.450 com vale-transporte. No RS o piso regional (R$ 1.884,75) leva o custo para cerca de R$ 2.700 a R$ 2.850. Por isso só cabe com renda acima de uns R$ 25 mil, que é a classe A (9%). Na B1, uma diarista 2 vezes por mês (3%). Nas demais, o serviço é feito pela família."],
  ["Contador", [1, 0, 0, 0, 0, 0], "Faz sentido para quem é autônomo, tem empresa ou declaração de imposto de renda complexa."],
  ["Banco", [0, 0, 0, 0, 0, 0], "Ideal é zero: há contas digitais gratuitas. Pagar tarifa é dinheiro que não volta."],
  ["Empréstimos", [0, 0, 0, 0, 0, 0], "Dívida de consumo: crédito pessoal, cheque especial, parcelamento de fatura. O financiamento da casa entra em Moradia e o do carro em Transporte. O ideal aqui é zero. Se houver, a soma das parcelas não deve passar de 15% da renda, e o dinheiro sai da parte de Previdência até a dívida acabar."],
  ["Cartão de crédito", [0, 0, 0, 0, 0, 0], "É forma de pagamento, não um gasto. As compras do cartão entram nas categorias acima, e a fatura é paga sempre inteira: o rotativo cobra mais de 100% ao ano."],
];
// Ordem: maior fatia da classe A primeiro; empate decide pela B1.
ORC.sort((x, y) => y[1][0] - x[1][0] || y[1][1] - x[1][1]);
const COLS = CLASSES.map(x => x.c);
ORC.forEach(([n, p]) => p.length !== 6 && console.warn("orçamento: linha incompleta", n));
COLS.forEach((c, i) => { const s = ORC.reduce((a, [, p]) => a + p[i], 0); if (s !== 100) console.warn("orçamento: classe", c, "soma", s); });

let st = { r: {}, estudo: null, agua: null, renda: "" };
try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {}
const salva = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

function pontos() {
  const faltam = ITENS.filter(i => st.r[i.k] == null).length + (st.estudo == null) + (st.agua == null);
  const p = ITENS.reduce((a, i) => a + (st.r[i.k] != null ? i.pts[st.r[i.k]] : 0), 0) + (st.agua ? 10 : 0) + (st.estudo != null ? ESTUDO[st.estudo][1] : 0);
  return { p, faltam };
}

function teste() {
  const opt = (sel, v, t) => `<option value="${v}"${sel === v ? " selected" : ""}>${t}</option>`;
  const q = i => `<label class="orc-q"><span><b>${i.p}</b>${i.dica ? `<span class="hint">${i.dica}</span>` : ""}</span>
    <select data-orc="${i.k}"><option value="">—</option>${[0, 1, 2, 3, 4].map(n => opt(st.r[i.k], n, n === 0 ? "não tem" : n === 4 ? "4 ou mais" : n)).join("")}</select></label>`;
  return `<div class="orc-form">
    ${ITENS.map(q).join("")}
    <label class="orc-q"><span><b>A casa recebe água da rede geral (água encanada da companhia)?</b></span>
      <select data-orc="agua"><option value="">—</option>${opt(st.agua, true, "sim")}${opt(st.agua, false, "não")}</select></label>
    <label class="orc-q"><span><b>Até onde estudou o chefe da família</b><span class="hint">A pessoa que traz a maior parte da renda da casa.</span></span>
      <select data-orc="estudo"><option value="">—</option>${ESTUDO.map(([t], i) => opt(st.estudo, i, t)).join("")}</select></label>
  </div>`;
}

function resultado() {
  const { p, faltam } = pontos();
  if (faltam) return `<div class="orc-res"><b>${p} pontos até agora</b><div class="hint">Faltam ${faltam} ${faltam === 1 ? "resposta" : "respostas"} para saber a classe.</div></div>`;
  const x = classeDe(p);
  return `<div class="orc-res on"><div class="orc-cl">Classe ${x.c}</div>
    <div><b>${p} pontos</b> <span class="hint">(a classe ${x.c} vai de ${faixa(x)})</span></div>
    <div>Renda média das famílias desta classe: <b>${brl(x.renda)} por mês</b></div>
    <div class="hint">${String(x.br).replace(".", ",")}% das casas do Brasil são classe ${x.c}; no Sul, ${String(x.sul).replace(".", ",")}%; na Grande Porto Alegre, ${String(x.poa).replace(".", ",")}%.</div></div>`;
}

function tabela() {
  const { p, faltam } = pontos(), minha = faltam ? null : classeDe(p).c;
  const i = st.ver != null ? st.ver : minha ? COLS.indexOf(minha) : 3, x = CLASSES[i];
  const renda = +String(st.renda).replace(/\./g, "").replace(",", ".") || x.renda;
  return `<div class="ftabs orc-tabs" role="tablist">${COLS.map((c, j) => `<button role="tab" data-orcver="${j}" aria-selected="${j === i}">Classe ${c}${c === minha ? " ★" : ""}</button>`).join("")}</div>
    <label class="orc-renda">Renda da família por mês: <input type="text" inputmode="decimal" data-orc="renda" value="${esc(st.renda)}" placeholder="${brl(x.renda).replace("R$ ", "")}"></label>
    <div class="hint">${st.renda ? "Valores calculados com a renda que você digitou." : `Sem renda digitada, os valores usam a renda média da classe ${x.c} (${brl(x.renda)}).`}</div>
    <div style="overflow-x:auto"><table class="edu-t orc-t"><tr><th>Categoria</th><th>%</th><th>Por mês</th></tr>
    ${ORC.map(([n, pc, nota]) => `<tr${pc[i] === 0 ? ' class="zero"' : ""}><td><b>${n}</b><div class="hint">${nota}</div></td><td class="num">${pc[i]}%</td><td class="num">${pc[i] ? brl(renda * pc[i] / 100) : "—"}</td></tr>`).join("")}
    <tr><td><b>Total</b></td><td class="num"><b>100%</b></td><td class="num"><b>${brl(renda)}</b></td></tr></table></div>`;
}

function comparativo() {
  return `<div style="overflow-x:auto"><table class="edu-t orc-t orc-all"><tr><th>Categoria</th>${COLS.map(c => `<th>${c}</th>`).join("")}</tr>
    ${ORC.map(([n, pc]) => `<tr><td>${n}</td>${pc.map(v => `<td class="num">${v ? v + "%" : "—"}</td>`).join("")}</tr>`).join("")}
    <tr><td>Renda média</td>${CLASSES.map(x => `<td class="num">${brl(x.renda).replace("R$ ", "")}</td>`).join("")}</tr></table></div>`;
}

function render() {
  const box = document.getElementById("orcBox"); if (!box) return;
  box.innerHTML = `
  <section class="card orc-card">
    <h3>🧾 Teste: qual é a sua classe social?</h3>
    <p class="hint">Usa o <b>Critério Brasil 2026</b>, da ABEP (Associação Brasileira de Empresas de Pesquisa), o padrão oficial de classe social usado no país por institutos como Datafolha, Ipsos-Ipec e Kantar IBOPE. Ele não pergunta a renda: olha o que a casa tem e o estudo do chefe da família, porque as pessoas costumam errar ou esconder a renda. Responda contando só o que está funcionando (ou que você vai consertar em até 6 meses).</p>
    ${teste()}
    <div id="orcRes">${resultado()}</div>
    <p class="hint">É uma classificação estatística, feita para grupos grandes: num caso individual pode errar. As respostas ficam só neste navegador. Fonte: <a href="https://abep.org/wp-content/uploads/2026/03/CCEB_2026.pdf" target="_blank" rel="noopener">ABEP, Critério Brasil, válido desde 05/02/2026</a>; renda média pela PNAD Contínua 2025 do IBGE.</p>
  </section>
  <section class="card orc-card">
    <h3>💰 Orçamento familiar para prosperar, por classe</h3>
    <p class="hint">Quanto de cada R$ 100 que a família ganha vai para cada categoria. As categorias são as mesmas do seu controle financeiro. A regra que mais pesa é a da <b>Previdência</b>: separar uma parte no dia do pagamento, antes de gastar. Quanto maior a renda, maior essa parte, porque o essencial (casa e comida) pesa menos.</p>
    <div id="orcTab">${tabela()}</div>
  </section>
  <section class="card orc-card">
    <h3>📊 As seis classes lado a lado</h3>
    ${comparativo()}
    <p class="hint">Como foi montado: a proporção de casa, comida e transporte segue o que as famílias de cada faixa de renda gastam na Pesquisa de Orçamentos Familiares do IBGE, ajustada para caber uma poupança crescente (de 5% na classe DE a 25% na A), na linha da regra 50-30-20 (necessidades, desejos e poupança). É uma referência geral escrita por IA (Claude), não um plano feito para a sua família. Quem tem dívidas, filhos pequenos ou mora em cidade cara precisa ajustar.</p>
  </section>`;
}

function liga() {
  const box = document.getElementById("orcBox"); if (!box || box.dataset.ligado) return;
  box.dataset.ligado = "1";
  box.addEventListener("change", e => {
    const k = e.target.dataset.orc; if (!k || k === "renda") return;
    const v = e.target.value;
    if (k === "agua") st.agua = v === "" ? null : v === "true";
    else if (k === "estudo") st.estudo = v === "" ? null : +v;
    else st.r[k] = v === "" ? null : +v;
    st.ver = null; salva();
    document.getElementById("orcRes").innerHTML = resultado();
    document.getElementById("orcTab").innerHTML = tabela();
  });
  box.addEventListener("input", e => {
    if (e.target.dataset.orc !== "renda") return;
    st.renda = e.target.value.replace(/[^\d.,]/g, ""); salva();
    const pos = e.target.selectionStart;
    document.getElementById("orcTab").innerHTML = tabela();
    const n = box.querySelector('[data-orc="renda"]'); n.focus(); try { n.setSelectionRange(pos, pos); } catch {}
  });
  box.addEventListener("click", e => {
    const b = e.target.closest("[data-orcver]"); if (!b) return;
    st.ver = +b.dataset.orcver; salva();
    document.getElementById("orcTab").innerHTML = tabela();
  });
}

const css = document.createElement("style");
css.textContent = `
.orc-card { padding: 16px 18px; margin-bottom: 14px; max-width: 900px; }
.orc-card h3 { margin: 0 0 6px; font-size: 17px; }
.orc-form { display: grid; gap: 8px; margin: 12px 0; }
.orc-q { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.orc-q > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.orc-q select { flex: none; width: 170px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.orc-res { padding: 12px 14px; border-radius: 10px; background: var(--panel-2); border: 1px dashed var(--line); margin: 6px 0 10px; display: grid; gap: 4px; }
.orc-res.on { background: var(--accent-soft); border: 1px solid var(--accent); }
.orc-cl { font-size: 26px; font-weight: 800; color: var(--accent); }
.orc-tabs { margin: 10px 0 8px; }
.orc-renda { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 600; margin: 6px 0 2px; }
.orc-renda input { width: 140px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.orc-t th { text-align: left; font-size: 12px; color: var(--muted); padding: 6px 8px 6px 0; border-bottom: 2px solid var(--line); }
.orc-t td.num, .orc-t th + th { text-align: right; white-space: nowrap; padding-left: 10px; }
.orc-t td:first-child { width: auto; color: var(--text); }
.orc-t tr.zero td { opacity: .65; }
.orc-all td { padding: 4px 0; font-size: 13px; }
@media (max-width: 560px) { .orc-q { flex-direction: column; align-items: stretch; } .orc-q select { width: 100%; } }`;
document.head.appendChild(css);

window.renderOrcamento = () => { liga(); render(); };
// the sub-tab may already be open when this file loads (the last one opened is remembered)
if (document.getElementById("orcBox") && !document.getElementById("orcBox").hidden) window.renderOrcamento();
})();

/**
 * dsh-bom — BOM 解析与成本汇总
 */

export const name = "dsh-bom";
export const inject = ["tools"];

const NL = String.fromCharCode(10);
const SITE = "https://deepseekbase.com/zh/tools/";
const TEXT_OUTPUT = {
  schema: { type: "object", additionalProperties: false, properties: { text: { type: "string" } }, required: ["text"] },
  render: (_args, value) => [{ type: "text", text: (value && value.text) || "" }],
};

function n(v, d) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function f(x) { return (Math.round(x * 100) / 100).toString(); }

function parseBom(text) {
  const rows = String(text || "").split(/\r?\n/).filter((x) => x.trim());
  if (!rows.length) throw new Error("BOM 不能为空");
  const sep = rows[0].indexOf("\t") >= 0 ? "\t" : ",";
  const head = rows[0].split(sep).map((x) => x.trim().toLowerCase());
  const idx = {
    name: head.findIndex((h) => /name|品名|名称|零件/.test(h)),
    qty: head.findIndex((h) => /qty|数量|用量/.test(h)),
    price: head.findIndex((h) => /price|单价|价格/.test(h)),
    cat: head.findIndex((h) => /cat|分类|类别/.test(h)),
  };
  if (idx.name < 0 || idx.qty < 0) throw new Error("表头需包含 品名(name) 与 数量(qty)");
  const items = rows.slice(1).map((r) => {
    const c = r.split(sep);
    return {
      name: (c[idx.name] || "").trim(),
      qty: n((c[idx.qty] || "").trim(), 0),
      price: idx.price >= 0 ? n((c[idx.price] || "").trim(), 0) : 0,
      cat: idx.cat >= 0 ? (c[idx.cat] || "未分类").trim() : "未分类",
    };
  }).filter((x) => x.name);
  return items;
}

const TOOLS = {
  bom_parse: {
    description: "解析 BOM（CSV/TSV）：校验数量与单价、汇总总额与分类占比",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { text: { type: "string", description: "BOM 文本，首行表头含 品名/数量/单价/分类" } },
      required: ["text"],
    },
    run(args) {
      const items = parseBom(args.text);
      let total = 0;
      const byCat = {};
      const lines = ["BOM 解析", "=".repeat(52)];
      for (const it of items) {
        const amount = it.qty * it.price;
        total += amount;
        byCat[it.cat] = (byCat[it.cat] || 0) + amount;
        if (it.qty <= 0) lines.push("提醒: " + it.name + " 数量为 0");
        if (it.price <= 0) lines.push("提醒: " + it.name + " 单价为 0");
      }
      lines.push("行数: " + items.length);
      lines.push("总金额: " + f(total));
      lines.push("");
      lines.push("分类占比:");
      Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).forEach((k) => {
        lines.push("  " + k + ": " + f(byCat[k]) + "（" + f(total ? byCat[k] / total * 100 : 0) + "%）");
      });
      lines.push("");
      lines.push("更多工具：" + SITE);
      return lines.join(NL);
    },
  },
  bom_quote: {
    description: "BOM 报价：材料成本 + 人工/制费/损耗 + 目标毛利，给出建议单价",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", description: "BOM 文本（同 bom_parse）" },
        labor_pct: { type: "number", description: "人工占材料成本比例 %，默认 15" },
        overhead_pct: { type: "number", description: "制费占比 %，默认 10" },
        scrap_pct: { type: "number", description: "损耗率 %，默认 3" },
        margin_pct: { type: "number", description: "目标毛利 %，默认 20" },
        qty: { type: "number", description: "报价数量，默认 1" },
      },
      required: ["text"],
    },
    run(args) {
      const items = parseBom(args.text);
      const material = items.reduce((a, b) => a + b.qty * b.price, 0);
      const labor = material * n(args.labor_pct, 15) / 100;
      const overhead = material * n(args.overhead_pct, 10) / 100;
      const scrap = material * n(args.scrap_pct, 3) / 100;
      const cost = material + labor + overhead + scrap;
      const margin = n(args.margin_pct, 20) / 100;
      const price = cost / (1 - margin);
      const qty = n(args.qty, 1);
      const lines = ["BOM 报价", "=".repeat(52), "材料成本: " + f(material), "人工: " + f(labor), "制费: " + f(overhead),
        "损耗: " + f(scrap), "总成本: " + f(cost), "毛利 " + (margin * 100) + "% → 建议单价: " + f(price),
        "数量 " + qty + " → 总价: " + f(price * qty), "", "报价为成本加成模型，实际需考虑批量、付款方式与汇率。", "",
        "更多工具：" + SITE];
      return lines.join(NL);
    },
  },
};

export function apply(ctx, config) {
  void config;
  for (const name of Object.keys(TOOLS)) {
    const t = TOOLS[name];
    ctx.tools.register({
      name: name,
      description: t.description,
      parameters: t.parameters,
      output: TEXT_OUTPUT,
      async execute(args) { try { return { text: t.run(args || {}) }; } catch (e) { return { text: "处理失败: " + String((e && e.message) || e) }; } },
    });
  }
}

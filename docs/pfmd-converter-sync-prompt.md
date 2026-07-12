# PFMD Converter 同步实施 Prompt

请在 `pfmd-deploy` 独立 task 中实施以下改动。先读取该 repo 当前 dirty changes，并与它们合并；不要覆盖另一个 task 已修改的 `admin.html`、pipeline、JSON 或 tests。使用 TDD：每个 bug 先写会失败的 regression test，再改 production code，最后跑 Python + Node 全套测试。

## 目标

PFMD 必须继续显示**全组**，不能复制 MD Dashboard 的 `GRP 2A` scope filter。新增 debtor type `Converter` 要进入 CCOM 销售、客户与 penetration 分析；8COM 继续独立监控，不计入 CCOM。

## 已确认的数据契约

- PFMD raw sales：`imports/raw/md-sales/daily/MD_SALES_LATEST.xlsx`，18 columns，最后一列为 `Debtor Type`。
- PFMD enriched sales：`imports/processed/daily/daily/MD_SALES_LATEST.enriched.xlsx`，业务列 + audit columns；必须按 header name 读取，禁止 positional index。
- 最新 debtor master：`imports/raw/debtor-maintenance/Debtor Maintainance_ALL.xlsx`。
- 当前 master 有 4 个 Converter：GRP1 1、GRP2A 2、GRP3 1。
- 已观察到 sales/master type mismatch：旧 sales 可能为 `P-Personal`，当前 master 已改成 `Converter`；保留两边来源并报告 mismatch，不要静默覆盖审计证据。

## 统一 debtor type policy

建立共享 normalize/classify helper，至少 canonicalize：

- `CONVERTER` / `converter` -> `Converter`，分类为 `business`。
- `PERSONAL` / `P-PERSONAL` -> `P-Personal`，分类为 `personal`。
- Dealer、Freelancer、Shop、Stall、Site 保留现有 canonical labels，分类为 `business`。
- 空白与未知类型分类为 `review_required`；不要自行决定 Staff、TBC、Bad Debt、O-Others、FT-Food Truck、FOC 的 KPI 资格。

Master type 为 account 当前真相；sales type 为交易当时证据。输出 `debtor_type_source`、`debtor_type_mismatch` 与 aggregate data-quality counts。

## 需要检查及修改的范围

1. **Import/enrichment pipeline**
   - `raw_sales_import.py`、`all_group_pipeline.py` 与任何 Excel loader 必须按 normalized header name 映射。
   - 验证 `Debtor Type` 插入后不会把 `UNIQ CODE`、RM/CTN、Sales type、QTY(CTN) 等字段右移。
   - 保留 raw debtor type、master debtor type、resolved type、mismatch audit。

2. **Sales dashboard**
   - type chips/options 必须 data-driven，并出现 `Converter`。
   - Converter 的 CCOM paid CTN 算业绩；item group `8COM` 只进入 8COM monitor。
   - debtor card、activation、new SKU、campaign claim 与导出都要保留 resolved debtor type。

3. **Management dashboard**
   - total/current/unpurchased/by-agent 统计包含 Converter business accounts。
   - 8COM monitor 继续显示「买 8COM 但没有 CCOM」客户，不混入 CCOM actual。
   - 所有 type/business filters 要使用共享 policy，不再维护各页不同的 hardcoded list。

4. **Debtor analysis**
   - PFMD 页面必须 fetch 全组 analysis payload，不得继续使用 Group2A `debtor_analysis_data.json`。
   - Converter 出现在 debtor base、records、filters、Excel/PDF export。
   - sales-only typed debtor 可显示，但标 `sales_report_only` / missing master；inactive master 仍由 master status 控制。

5. **SKU Strength / Penetration / Gap**
   - PFMD 要生成全组 report data；不要套用 MD 的 `Area == GRP 2A`。
   - `Converter` 加入默认 business type view；大小写必须 canonicalize。
   - 所有 SKU report builders 复用 PFMD 的 central normalized sales loader，不可另写一套较弱的 sheet/header contract。
   - 查清 PFMD 缺少 source `build_report_data.py`、只留下静态 assets/pyc 的问题，建立可重跑生成步骤。

6. **Admin**
   - Admin 的 debtor-type/campaign filter options 必须由 live payload 产生，fallback 也包含 Converter。
   - 不把 Converter 加进 brand/SKU target template；它是 debtor type，不是 brand。
   - 清理重复定义时先确认后定义覆盖前定义的问题，并以 tests 锁住实际执行版本。

7. **Daily update / freshness**
   - 明确 raw sales、enriched sales、debtor master 的 source metadata（filename、size、mtime、generated_at）。
   - `dashboard_data.json`、`all_group_dashboard_data.json`、debtor analysis 与 SKU reports 必须来自同一批 source snapshot。
   - 不复制 workbook 到 repo 覆盖本地资料；用环境变量/CLI path 传入。
   - Daily update 只 stage 明确列出的 generated artifacts；source/UI 改动必须独立 review/commit，不能被 data refresh 顺手发布。

## 必须新增的 regression tests

- 18-column raw + enriched schema 的 header mapping。
- Converter business、P-Personal excluded、unknown review-required policy。
- sales/master mismatch 与 sales-only debtor fallback。
- PFMD 全组 payload 不被 Group2A filter 截断。
- Sales/management/debtor analysis/SKU report 的 Converter options 与 totals。
- CCOM/8COM split：同一 Converter debtor 的 8COM CTN 不进入 CCOM。
- Generated JSON 无 `NaN` / `Infinity`，source timestamps 一致。

## 验收

- Python 与 Node 全套 tests 0 failure。
- 输出 4 个 master Converter，按全组 area 分布 1/2/1；若数量改变，以最新 source 为准并报告差异。
- PFMD type filter 可选择 Converter；management 与 debtor analysis 可 drill down。
- CCOM + 8COM reconciliation 与 raw/enriched source totals 对得上。
- 不修改 MD Dashboard repo；不覆盖 PFMD task 中原有未提交改动。

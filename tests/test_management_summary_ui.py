import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ManagementSummaryUiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        summary_start = html.index("async function renderMonthlySummary()")
        export_start = html.index("function exportMonthlyExcel()", summary_start)
        export_end = html.index("function exportDropExcel()", export_start)
        overview_start = html.index("function renderOverview()")
        overview_end = html.index("function renderAnnualProgress()", overview_start)
        newbie_start = html.index("function renderAgentProgressNewbie")
        newbie_end = html.index("function progressKpiOptions", newbie_start)
        kpi_start = html.index("function renderAgentProgressKpi")
        kpi_end = html.index("function progressZlbBrands", kpi_start)
        zlb_start = html.index("const PROGRESS_ZLB_BRAND_ORDER")
        zlb_end = html.index("function renderAgentProgressSkuTrace", zlb_start)
        unpurchased_start = html.index("let mgmtUnpurchasedMode")
        unpurchased_end = html.index("function renderGainingDebtorsPage", unpurchased_start)
        leaderboard_start = html.index("function setLbMode")
        leaderboard_end = html.index("//", leaderboard_start)
        group_start = html.index("function renderGroupBrands")
        group_end = html.index("//", group_start)
        brand_start = html.index("function renderCommHeatmap")
        brand_end = html.index("function renderBrandVolumeAlert", brand_start)
        drill_start = html.index("let MGMT_OVERVIEW_SCROLL_Y")
        drill_end = html.index("// ── Analytics", drill_start)
        cls.monthly_summary_js = html[summary_start:export_start]
        cls.monthly_export_js = html[export_start:export_end]
        cls.overview_js = html[overview_start:overview_end]
        cls.newbie_js = html[newbie_start:newbie_end]
        cls.kpi_js = html[kpi_start:kpi_end]
        cls.zlb_js = html[zlb_start:zlb_end]
        cls.unpurchased_js = html[unpurchased_start:unpurchased_end]
        cls.leaderboard_js = html[leaderboard_start:leaderboard_end]
        cls.group_brand_js = html[group_start:group_end]
        cls.brand_commission_js = html[brand_start:brand_end]
        cls.drill_js = html[drill_start:drill_end]

    def test_team_performance_overview_has_t2_ga_event_and_campaign_columns(self):
        for label in ("NORMAL T2", "GA", "MA", "Birthday Gift", "EVENT", "CAMPAIGN"):
            self.assertIn(label, self.monthly_summary_js)

        self.assertIn("normal_t2", self.monthly_summary_js)
        self.assertIn("tiers?.ga", self.monthly_summary_js)
        self.assertIn("kpiItems.birthday_campaign", self.monthly_summary_js)
        self.assertIn("kpiItems.event", self.monthly_summary_js)
        self.assertIn("currentCampaignProgressSummary", self.monthly_summary_js)

    def test_team_performance_overview_column_sequence_matches_requested_flow(self):
        expected = (
            "NORMAL T1",
            "NORMAL T2",
            "GA",
            "MA",
            "光顾率",
            "开新户口",
            "VIP",
            "激活户口",
            "加SKU",
            "Birthday Gift",
            "EVENT",
            "CAMPAIGN",
        )
        positions = [self.monthly_summary_js.index(f"l:'{label}'") for label in expected]
        self.assertEqual(positions, sorted(positions))

    def test_team_performance_first_five_columns_are_pace_sensitive(self):
        self.assertIn("expectedPace", self.monthly_summary_js)
        self.assertIn("paceSensitive", self.monthly_summary_js)
        for snippet in (
            "atCell(tierActual(normalT1, sp.normal_ctn), t1tgt, false, true)",
            "atCell(tierActual(normalT2, sp.normal_ctn), t2tgt, false, true)",
            "atCell(tierActual(gaTier, sp.ga_ctn), gatgt, false, true)",
            "atCell(tierActual(maTier, sp.ma_ctn), matgt, false, true)",
            "atCell(rateAct, rateTgt, true, true)",
        ):
            self.assertIn(snippet, self.monthly_summary_js)

    def test_monthly_excel_export_has_matching_t2_ga_and_campaign_columns(self):
        for label in (
            "Target Normal T2",
            "Actual Normal T2",
            "Normal T2 %",
            "Target GA",
            "Actual GA",
            "GA %",
            "Target Birthday Gift",
            "Actual Birthday Gift",
            "Birthday Gift %",
            "Target Event",
            "Actual Event",
            "Event %",
            "Current Campaign Actual",
            "Current Campaign Target",
            "Current Campaign %",
            "Campaign Score",
            "Campaign Max",
            "Campaign %",
        ):
            self.assertIn(label, self.monthly_export_js)

    def test_team_t1_overview_percentage_keeps_decimal_progress(self):
        self.assertIn("teamNormalCtn/teamT1Target*100", self.overview_js)
        self.assertNotIn("Math.round(teamNormalCtn/teamT1Target*100)", self.overview_js)

    def test_newbie_board_shows_ctn_and_account_tier_targets(self):
        self.assertIn("newbieTierLine", self.newbie_js)
        self.assertIn("ctn_tiers", self.newbie_js)
        self.assertIn("account_tiers", self.newbie_js)
        self.assertIn("CTN Tier Target", self.newbie_js)
        self.assertIn("开新户口 Tier Target", self.newbie_js)
        self.assertNotIn("'Next CTN'", self.newbie_js)

    def test_lower_duplicate_newbie_progress_section_is_removed(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        self.assertIn("function renderAgentProgressNewbie", html)
        self.assertIn("data-tab=\"newbie\"", html)
        self.assertNotIn("id=\"newbie-section\"", html)
        self.assertNotIn("id=\"newbie-cards\"", html)
        self.assertNotIn("function renderNewbieProgress", html)
        self.assertNotIn("renderNewbieProgress();", html)

    def test_agent_leaderboard_defaults_to_minimized_summary(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        self.assertIn("let LEADERBOARD_EXPANDED = false", html)
        self.assertIn("id=\"leaderboard-mini\"", html)
        self.assertIn("id=\"leaderboard-toggle-view\"", html)
        self.assertIn("function toggleLeaderboard", self.leaderboard_js)
        self.assertIn("if(!LEADERBOARD_EXPANDED)", self.leaderboard_js)
        self.assertIn("Top 3", self.leaderboard_js)

    def test_group_brand_targets_are_colored_against_working_day_pace(self):
        self.assertIn("const pace = apPace(DATA)", self.group_brand_js)
        self.assertIn("target_ctn||0) * pace / 100", self.group_brand_js)
        self.assertIn("groupBrandPaceColor", self.group_brand_js)
        self.assertIn("groupBrandPaceBarColor", self.group_brand_js)
        self.assertIn("应达", self.group_brand_js)
        self.assertIn("paceGap", self.group_brand_js)

    def test_kpi_board_chips_use_bound_buttons_instead_of_inline_onclick(self):
        self.assertIn("data-kpi-key", self.kpi_js)
        self.assertNotIn("onclick=\"setProgressKpiMetric", self.kpi_js)
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        self.assertIn("[data-kpi-key]", html)
        self.assertIn("setProgressKpiMetric(btn.dataset.kpiKey", html)

    def test_zlb_board_shows_previous_month_average_and_lowest_columns(self):
        for label in ("未购买/总户口", "上月条数", "本月条数", "前三个月平均", "三个月最低"):
            self.assertIn(label, self.zlb_js)
        self.assertIn("progressZlbPrevMonthLabels", self.zlb_js)
        self.assertIn("progressZlbBrandCtnForMonth", self.zlb_js)
        self.assertIn("progressZlbBrandAverageForMonths", self.zlb_js)
        self.assertIn("progressZlbBrandMinForMonths", self.zlb_js)
        self.assertIn("progressZlbTotalDebtors", self.zlb_js)
        self.assertIn("non_buyers", self.zlb_js)
        self.assertIn("zlbTotalRow", self.zlb_js)
        self.assertNotIn("上月+本月", self.zlb_js)
        self.assertNotIn("'总数'", self.zlb_js)

    def test_zlb_board_separates_current_buyers_from_new_penetration_target(self):
        self.assertIn("本月购买顾客", self.zlb_js)
        self.assertIn("新增渗透/目标", self.zlb_js)
        self.assertIn("const curBuyers = Number(b.cur_buyers ?? penCount);", self.zlb_js)
        self.assertIn("totals.curBuyers += curBuyers", self.zlb_js)
        self.assertIn("curBuyers", self.zlb_js)

    def test_zlb_total_debtors_prefers_active_non_personal_debtor_list(self):
        self.assertIn("const nonPersonalDebtors = (dc.debtors || []).filter", self.zlb_js)
        self.assertIn("!mgmtIsPersonal(debtor)", self.zlb_js)
        self.assertIn("debtor.dm_active !== false", self.zlb_js)
        self.assertIn("if (nonPersonalDebtors.length || (dc.debtors || []).length) return nonPersonalDebtors.length;", self.zlb_js)
        self.assertLess(
            self.zlb_js.index("nonPersonalDebtors"),
            self.zlb_js.index("const direct = Number(dc.total_debtors ?? dc.activation_base)")
        )

    def test_zlb_customer_buttons_open_filtered_unpurchased_list(self):
        self.assertIn("openAgentZlbCustomers", self.zlb_js)
        self.assertIn("data-zlb-customer-agent", self.zlb_js)
        self.assertIn("data-zlb-customer-brand", self.zlb_js)
        self.assertIn("'buyers'", self.zlb_js)
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        self.assertIn("[data-zlb-customer-agent]", html)
        self.assertIn("openAgentZlbCustomers(", html)
        self.assertIn("btn.dataset.zlbCustomerAgent", html)
        self.assertIn("btn.dataset.zlbCustomerView", html)

    def test_zlb_brand_chips_follow_requested_order(self):
        self.assertIn("PROGRESS_ZLB_BRAND_ORDER", self.zlb_js)
        expected = ("'iFACE'", "'SUKUN'", "'EVO'", "'BISON'", "'LAM+LWM'")
        positions = [self.zlb_js.index(label) for label in expected]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("progressZlbBrandSortKey", self.zlb_js)

    def test_zlb_previous_month_uses_configured_brand_items_before_fallback(self):
        self.assertIn("configured.length ? configured", self.zlb_js)
        self.assertNotIn("...(configured || []), ...(fallback[brand] || fallback[brandKey] || [])", self.zlb_js)

    def test_zlb_customer_list_supports_current_month_buyers(self):
        self.assertIn("mgmtUnpurchasedView", self.unpurchased_js)
        self.assertIn("currentMonthCtn", self.unpurchased_js)
        self.assertIn("prevLookbackCtn", self.unpurchased_js)
        self.assertIn("setMgmtUnpurchasedView", self.unpurchased_js)
        self.assertIn("本月购买", self.unpurchased_js)
        self.assertIn("mgmtUnpurchasedView === 'buyers'", self.unpurchased_js)
        self.assertIn("Number(stats?.prevLookbackCtn || 0) === 0", self.unpurchased_js)
        self.assertNotIn("Number(stats?.total || 0) === 0", self.unpurchased_js)
        self.assertNotIn("从未购买", self.unpurchased_js)

    def test_brand_commission_merges_penetration_context_into_status_table(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        self.assertIn("brand-team-grid merged", html)
        self.assertIn("Commission Status + Penetration", html)
        self.assertNotIn("brand-team-panel-title\">Penetration / Non-buyers", html)
        self.assertIn("comm-status-main", html)
        self.assertIn("comm-status-meta", html)
        self.assertIn("comm-status-sub", html)
        self.assertIn("bdata.penetration", self.brand_commission_js)
        self.assertIn("bdata.non_buyers", self.brand_commission_js)
        self.assertIn("bdata.ctn", self.brand_commission_js)
        self.assertIn("_lastBrandExport", self.brand_commission_js)
        self.assertIn("brand_data", self.brand_commission_js)

    def test_brand_commission_shows_agent_counts_for_penetration_and_qty_hits(self):
        self.assertIn("Pen Hit Agents", self.brand_commission_js)
        self.assertIn("Sales Qty Hit Agents", self.brand_commission_js)
        self.assertIn("penHitAgents", self.brand_commission_js)
        self.assertIn("ctnHitAgents", self.brand_commission_js)
        self.assertNotIn("penHitCount", self.brand_commission_js)
        self.assertNotIn("ctnHitCount", self.brand_commission_js)
        self.assertIn("pen.hit", self.brand_commission_js)
        self.assertIn("ctn.hit", self.brand_commission_js)
        self.assertIn("penHits", self.brand_commission_js)
        self.assertIn("ctnHits", self.brand_commission_js)
        self.assertIn("agents hit", self.brand_commission_js)
        self.assertIn("brand hits", self.brand_commission_js)

    def test_team_sales_progress_shows_bucket_targets_and_total_breakdown(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        for element_id in (
            "ov-ctn-breakdown",
            "ov-paid-month-breakdown",
            "ov-normal-target",
            "ov-ga-target",
            "ov-ma-target",
        ):
            self.assertIn(element_id, html)

        self.assertIn("teamGaTarget", self.overview_js)
        self.assertIn("teamMaTarget", self.overview_js)
        self.assertIn("ov-ctn-breakdown", self.overview_js)
        self.assertIn("cur_month_invoiced_paid", self.overview_js)
        self.assertIn("prev_month_ctn", self.overview_js)
        self.assertIn("本月单已付款", self.overview_js)
        self.assertIn("前月单本月付款", self.overview_js)
        self.assertNotIn("this-month invoice paid", self.overview_js)
        self.assertNotIn("previous invoice paid", self.overview_js)

    def test_team_sales_progress_has_team_kpi_summary_chips(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        for element_id in (
            "ov-team-summary",
            "ov-team-new",
            "ov-team-rate",
            "ov-team-reactivation",
            "ov-team-sku",
            "ov-team-event",
            "ov-team-birthday",
            "ov-team-3m-return",
        ):
            self.assertIn(element_id, html)

        self.assertIn("overviewThreeMonthReturnCount", html)
        self.assertIn("ctn_cur", html)
        self.assertIn("ctn_prev1", html)
        self.assertIn("ctn_prev2", html)
        self.assertIn("ctn_prev3", html)
        self.assertIn("is_new", html)
        self.assertIn("kpi?.items?.new_accounts", self.overview_js)
        self.assertIn("kpi?.items?.event", self.overview_js)
        self.assertIn("kpi?.items?.birthday_campaign", self.overview_js)
        self.assertLess(html.index("class=\"ov-totals\""), html.index("id=\"ov-team-summary\""))

    def test_team_sales_progress_dark_card_has_readable_detail_contrast(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        self.assertIn("rgba(255,255,255,.72)", html)
        self.assertIn("rgba(255,255,255,.68)", html)
        self.assertIn("border:1px solid rgba(255,255,255,.1)", html)

    def test_management_page_uses_agent_progress_typography(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        self.assertIn("--display:'DM Sans',sans-serif", html)
        self.assertIn("--mono:'DM Sans',sans-serif", html)
        self.assertIn(".sec-lbl{font-family:var(--body)", html)
        self.assertIn("#overview-view [style*=\"font-family:var(--mono)\"]", html)
        self.assertIn("letter-spacing:0!important", html)
        self.assertNotIn("--display:'Bebas Neue'", html)
        self.assertNotIn(".header-title{font-family:var(--display)", html)
        self.assertNotIn(".sec-lbl{font-family:var(--mono)", html)
        self.assertNotIn(".ov-pct{font-family:var(--display)", html)
        self.assertNotIn(".kpi-val{font-family:var(--display)", html)

    def test_team_sales_progress_uses_refined_overview_layout(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        for snippet in (
            "class=\"ov-card-head\"",
            "class=\"ov-primary\"",
            "class=\"ov-side\"",
            "class=\"ov-section-label\"",
            "class=\"ov-total\" id=\"ov-ctn\"",
            "class=\"ov-total-label\"",
            "class=\"ov-summary-title\"",
        ):
            self.assertIn(snippet, html)

    def test_team_sales_progress_summary_stays_compact(self):
        html = (ROOT / "management.html").read_text(encoding="utf-8")
        self.assertIn(".ov-team-summary{display:grid;grid-template-columns:repeat(7,minmax(104px,1fr));", html)
        self.assertIn(".ov-team-summary{grid-template-columns:repeat(7,minmax(100px,1fr));", html)
        self.assertNotIn(".ov-totals,.dr-stats{grid-template-columns:1fr;}", html)

    def test_agent_drill_back_restores_previous_overview_scroll(self):
        self.assertIn("MGMT_OVERVIEW_SCROLL_Y", self.drill_js)
        self.assertIn("restoreOverviewScroll", self.drill_js)
        self.assertNotIn("function closeDrill(){\n  document.getElementById('drill-view').classList.remove('active');\n  document.getElementById('overview-view').classList.add('active');\n  window.scrollTo(0,0);", self.drill_js)


if __name__ == "__main__":
    unittest.main()

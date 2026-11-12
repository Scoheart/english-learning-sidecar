import SwiftUI
import AppKit
import SidecarCore

struct LessonDetail: View {
    @ObservedObject var store: DesktopStore
    let lesson: Lesson
    @State private var tab = "lexis"
    @State private var deleting = false
    @State private var copiedHero = false
    @State private var copiedParagraph = false
    @State private var heroCopyToken = UUID()
    @State private var paragraphCopyToken = UUID()

    private var analysis: LessonAnalysis? { lesson.analysis }
    private var cleanHeroEnglish: String {
        (analysis?.translation ?? "")
            .replacingOccurrences(of: "[Demo preview]", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private var activeSpeechModel: SafeModel? {
        store.models.first { $0.id == store.activeSpeechID && $0.kind == "speech" } ?? store.status?.activeSpeechModel
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                heroCard

                if let analysis, lesson.status == "complete" {
                    progressiveTabsSection(analysis: analysis)
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 24)
            .frame(maxWidth: 1600, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .onAppear {
            if lesson.status == "complete" { store.markRead(lesson.id) }
        }
        .onChange(of: lesson.id) { _, _ in
            tab = "lexis"
            deleting = false
            copiedHero = false
            copiedParagraph = false
            heroCopyToken = UUID()
            paragraphCopyToken = UUID()
            store.speech.stop()
            if lesson.status == "complete" { store.markRead(lesson.id) }
        }
        .onChange(of: lesson.status) { _, value in
            if value == "complete" { store.markRead(lesson.id) }
        }
        .confirmationDialog(
            "删除提示卡片？默认只删除此卡片，保留已积累的词汇与语法。",
            isPresented: $deleting,
            titleVisibility: .visible
        ) {
            Button("只删除卡片", role: .destructive) {
                deleteLesson(purgeKnowledge: false)
            }
            Button("删除卡片及关联知识", role: .destructive) {
                deleteLesson(purgeKnowledge: true)
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("此操作会影响本机共享学习服务，且不可撤销。")
        }
    }

    private func deleteLesson(purgeKnowledge: Bool) {
        let suffix = purgeKnowledge ? "?knowledge=purge" : ""
        Task {
            if await store.mutate("/api/events/\(lesson.id)\(suffix)", method: "DELETE") {
                if store.openedLesson?.id == lesson.id { store.openedLesson = nil }
                store.reconcileHistorySelection()
            }
        }
    }

    // MARK: - 1. Hero Prompt & Natural English Card (Aligned with App.tsx Card 1)

    private var heroCard: some View {
        StudioSurfaceCard(topStripe: .heroGradient, padding: 22, spacing: 16, hoverable: false) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 12) {
                    heroMetadata.fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 8)
                    heroActions.fixedSize(horizontal: true, vertical: false)
                }
                VStack(alignment: .leading, spacing: 12) {
                    heroMetadata
                    heroActions
                }
            }

            StudioDetailSpeechNotice(speech: store.speech)

            // Original Prompt & English Translation
            VStack(alignment: .leading, spacing: 14) {
                Text(verbatim: lesson.originalDisplayTitle)
                    .font(StudioFont.editorial(size: 23, weight: .semibold))
                    .foregroundStyle(StudioPalette.foreground)
                    .lineSpacing(5)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)

                if lesson.status == "complete", let analysis {
                    if !cleanHeroEnglish.isEmpty {
                        Text(verbatim: cleanHeroEnglish)
                            .font(StudioFont.editorial(size: 24, weight: .semibold))
                            .foregroundStyle(StudioPalette.foreground)
                            .lineSpacing(5)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("未生成英文翻译")
                            .font(StudioFont.ui(size: 13))
                            .foregroundStyle(StudioPalette.mutedForeground)
                    }

                    if let summary = analysis.summary, !summary.isEmpty {
                        Text(summary)
                            .font(StudioFont.ui(size: 12.5))
                            .foregroundStyle(StudioPalette.mutedForeground)
                            .lineSpacing(3)
                            .textSelection(.enabled)
                    }
                } else {
                    statusPlaceholderView
                }
            }

            // Color-Annotated Inline Refinement Comparison (matching App.tsx lines 794-836)
            if let corrections = analysis?.corrections, !corrections.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(corrections.enumerated()), id: \.offset) { _, correction in
                        StudioCorrectionCard(correction: correction)
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    private var heroMetadata: some View {
        LessonDetailFlowLayout(spacing: 8) {
            StudioTaskStatusBadge(status: lesson.status)

            StudioBadge(text: lesson.sourceName, style: .secondary)

            if let analysis, lesson.status == "complete" {
                let meta = StudioCorrectionMeta.from(analysis.correctionStatus)
                StudioBadge(text: meta.label, style: .accent(meta.accent))
            }

            let relTime = StudioTime.relative(lesson.createdAt, date: lesson.date)
            if !relTime.isEmpty {
                Text(relTime)
                    .font(StudioFont.ui(size: 11.5))
                    .foregroundStyle(StudioPalette.mutedForeground)
            }
        }
    }

    private var heroActions: some View {
        LessonDetailFlowLayout(spacing: 7) {
            if !cleanHeroEnglish.isEmpty {
                StudioDetailListenButton(speech: store.speech, api: store.api,
                                         remote: store.activeSpeechID != nil,
                                         text: cleanHeroEnglish, helpText: "朗读英文表达")

                StudioBadge(
                    text: activeSpeechModel?.name ?? "System voice",
                    style: .dashedOutline
                )
                .help(
                    activeSpeechModel.map {
                        "TTS Model: \($0.name) (\($0.model)) · Voice: \($0.voice ?? "marin")"
                    } ?? "macOS System Speech Synthesizer"
                )

                StudioActionButton(
                    label: copiedHero ? "Copied" : "Copy English",
                    icon: copiedHero ? "checkmark" : "doc.on.doc",
                    variant: .primary,
                    small: true,
                    helpText: "复制英文表达"
                ) {
                    copyText(cleanHeroEnglish, flag: $copiedHero, token: $heroCopyToken)
                }
            }

            if ["failed", "cancelled"].contains(lesson.status) {
                StudioActionButton(
                    label: "Retry",
                    icon: "arrow.clockwise",
                    variant: .outline,
                    small: true,
                    helpText: "重新分析此提示"
                ) {
                    Task { await store.mutate("/api/events/\(lesson.id)/retry") }
                }
            }

            if ["pending", "processing"].contains(lesson.status) {
                StudioActionButton(
                    label: "取消分析",
                    icon: "stop.circle",
                    variant: .outline,
                    small: true,
                    helpText: "取消后台分析任务"
                ) {
                    Task { await store.mutate("/api/events/\(lesson.id)/cancel") }
                }
            }

            StudioActionButton(
                label: nil,
                icon: "trash",
                variant: .ghost,
                small: true,
                helpText: "删除此提示卡片"
            ) {
                deleting = true
            }
            .accessibilityLabel("删除此提示卡片")
        }
    }

    @ViewBuilder
    private var statusPlaceholderView: some View {
        let message: String = {
            if store.status?.mode == "unconfigured" && lesson.status == "pending" {
                return "此提示已加入队列。配置并启用文本模型后会自动处理。"
            }
            if let error = lesson.error, !error.isEmpty {
                return error
            }
            switch lesson.status {
            case "cancelled": return "分析已取消，可点击右上角 Retry 重试。"
            case "skipped":   return "此提示已被过滤，未产生英语讲解。"
            case "failed":    return "分析失败，请点击右上角 Retry 重试。"
            case "pending":   return "提示已排队，将在后台自动处理。"
            default:          return "正在后台生成四维英语讲解…"
            }
        }()

        HStack(spacing: 10) {
            if ["pending", "processing"].contains(lesson.status) {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: lesson.status == "failed" ? "exclamationmark.triangle.fill" : "info.circle")
                    .foregroundStyle(lesson.status == "failed" ? StudioAccent.rose.solid : StudioPalette.mutedForeground)
            }
            Text(message)
                .font(StudioFont.ui(size: 13))
                .foregroundStyle(StudioPalette.mutedForeground)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(StudioPalette.muted.opacity(0.65), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    // MARK: - 2. 4-Layer Progressive Disclosure Tabs (字与词 · 句法拆解 · 篇章成段 · 实战举一反三)

    private func progressiveTabsSection(analysis: LessonAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView(.horizontal) {
                StudioSegmentedTabs(
                    selection: $tab,
                    options: [
                        StudioTabOption(id: "lexis", title: "字与词", count: analysis.vocabulary?.count),
                        StudioTabOption(id: "sentence", title: "句法拆解"),
                        StudioTabOption(id: "discourse", title: "篇章成段"),
                        StudioTabOption(id: "examples", title: "实战举一反三", count: analysis.examples?.count)
                    ],
                    fullWidth: false
                )
                .fixedSize(horizontal: true, vertical: false)
                .padding(.bottom, 2)
            }
            .scrollIndicators(.visible)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: 40, alignment: .leading)
            .accessibilityLabel("英语讲解层级")

            switch tab {
            case "sentence":
                sentenceTab(analysis: analysis)
            case "discourse":
                discourseTab(analysis: analysis)
            case "examples":
                examplesTab(analysis: analysis)
            default:
                lexisTab(analysis: analysis)
            }
        }
    }

    // MARK: - Tab 1: 字与词 (Morphology, Collocations, Senses, Word Family, Synonyms/Antonyms)

    @ViewBuilder
    private func lexisTab(analysis: LessonAnalysis) -> some View {
        let vocab = analysis.vocabulary ?? []
        if vocab.isEmpty {
            emptySectionCard(text: "这条记录暂无词汇拆解。")
        } else {
            LessonDetailGrid(maxColumns: 4, spacing: 16) {
                ForEach(Array(vocab.enumerated()), id: \.offset) { _, word in
                    StudioVocabularyCard(
                        store: store,
                        eventID: lesson.id,
                        word: word,
                        singleColumnExpanded: vocab.count == 1,
                        speech: store.speech,
                        api: store.api,
                        remoteTTS: store.activeSpeechID != nil
                    )
                    .id("\(lesson.id):\(word.term)")
                }
            }
        }
    }

    // MARK: - Tab 2: 句法拆解 (Pattern, Tense, Voice, Color-Coded Constituents & Grammar)

    @ViewBuilder
    private func sentenceTab(analysis: LessonAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            // 3 Summary Cards: Pattern, Tense, Voice
            LessonDetailGrid(maxColumns: 3, intermediateColumns: 3, spacing: 12) {
                anatomyMetricCard(
                    title: "句子结构 · PATTERN",
                    value: analysis.sentenceAnatomy?.pattern ?? "暂无分析",
                    accent: .indigo
                )
                anatomyMetricCard(
                    title: "时态解析 · TENSE",
                    value: analysis.sentenceAnatomy?.tense ?? "暂无分析",
                    accent: .amber
                )
                anatomyMetricCard(
                    title: "语态解析 · VOICE",
                    value: analysis.sentenceAnatomy?.voice ?? "暂无分析",
                    accent: .emerald
                )
            }

            // Color-Coded Sentence Constituents
            if let constituents = analysis.sentenceAnatomy?.constituents, !constituents.isEmpty {
                StudioSurfaceCard(padding: 18, spacing: 14, hoverable: false) {
                    LessonDetailFlowLayout(spacing: 10) {
                        HStack(spacing: 7) {
                            Image(systemName: "square.3.layers.3d")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(StudioPalette.primary)
                            Text("句子组成成分分色拆解 · Sentence Constituents")
                                .font(StudioFont.ui(size: 13.5, weight: .semibold))
                                .foregroundStyle(StudioPalette.foreground)
                        }
                        Text("不同语法角色采用独立色系标注")
                            .font(StudioFont.ui(size: 11))
                            .foregroundStyle(StudioPalette.mutedForeground)
                    }

                    LessonDetailGrid(maxColumns: 3, spacing: 12) {
                        ForEach(Array(constituents.enumerated()), id: \.offset) { idx, part in
                            let accent = StudioAccent.forConstituent(role: part.role, index: idx)
                            VStack(alignment: .leading, spacing: 9) {
                                HStack {
                                    StudioBadge(
                                        text: part.role,
                                        dotColor: accent.solid,
                                        style: .accent(accent)
                                    )
                                    Spacer()
                                    SpeechButton(
                                        speech: store.speech,
                                        api: store.api,
                                        remote: store.activeSpeechID != nil,
                                        text: part.fragment
                                    )
                                }

                                Text(verbatim: part.fragment)
                                    .font(StudioFont.phonetic(size: 13, weight: .semibold))
                                    .foregroundStyle(StudioPalette.foreground)
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)

                                HStack(alignment: .top, spacing: 0) {
                                    RoundedRectangle(cornerRadius: 1)
                                        .fill(accent.solid.opacity(0.75))
                                        .frame(width: 2)
                                    Text(part.explanation)
                                        .font(StudioFont.ui(size: 12))
                                        .foregroundStyle(StudioPalette.foreground.opacity(0.84))
                                        .lineSpacing(2.5)
                                        .padding(.leading, 8)
                                        .textSelection(.enabled)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .padding(13)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(accent.surfaceFill, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 11, style: .continuous)
                                    .strokeBorder(accent.surfaceBorder, lineWidth: 1)
                            )
                        }
                    }
                }
            }

            // Grammar Cards
            if let grammars = analysis.grammar, !grammars.isEmpty {
                LessonDetailGrid(maxColumns: 3, spacing: 14) {
                    ForEach(Array(grammars.enumerated()), id: \.offset) { idx, g in
                        StudioSurfaceCard(leftStripe: .cyan, padding: 16, spacing: 9) {
                            HStack(spacing: 8) {
                                StudioBadge(
                                    text: String(format: "GRAMMAR %02d", idx + 1),
                                    style: .accent(.cyan),
                                    monospaced: true
                                )
                                Text(g.label)
                                    .font(StudioFont.ui(size: 13.5, weight: .semibold))
                                    .foregroundStyle(StudioPalette.foreground)
                                Spacer()
                                StudioFavoriteStarButton(
                                    store: store,
                                    term: g.label,
                                    meaning: g.explanation,
                                    category: "grammar",
                                    eventID: lesson.id
                                )
                            }
                            Text(g.explanation)
                                .font(StudioFont.ui(size: 12.5))
                                .foregroundStyle(StudioPalette.foreground.opacity(0.86))
                                .lineSpacing(3)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    private func anatomyMetricCard(title: String, value: String, accent: StudioAccent) -> some View {
        StudioSurfaceCard(topStripe: .solid(accent), tint: accent, padding: 15, spacing: 6) {
            Text(title)
                .font(StudioFont.ui(size: 10.5, weight: .bold))
                .tracking(0.5)
                .foregroundStyle(accent.text)
            Text(value)
                .font(StudioFont.ui(size: 12.5, weight: .semibold))
                .foregroundStyle(StudioPalette.foreground)
                .lineSpacing(2.5)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Tab 3: 篇章成段 (Discourse Logic, Cohesion, Pragmatic Notes & Extended Paragraph)

    @ViewBuilder
    private func discourseTab(analysis: LessonAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            LessonDetailGrid(maxColumns: 2, spacing: 14) {
                StudioSurfaceCard(topStripe: .solid(.sky), padding: 17, spacing: 11) {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(StudioAccent.sky.text)
                        Text("句群逻辑推进 · Discourse Logic")
                            .font(StudioFont.ui(size: 13.5, weight: .semibold))
                            .foregroundStyle(StudioPalette.foreground)
                    }
                    StudioCalloutBlock(
                        title: "",
                        text: analysis.discourse?.logic ?? "暂无分析",
                        accent: .sky,
                        enclosedBox: true
                    )
                }

                StudioSurfaceCard(topStripe: .solid(.violet), padding: 17, spacing: 11) {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(StudioAccent.violet.text)
                        Text("中英思维与成段转换 · Cohesion")
                            .font(StudioFont.ui(size: 13.5, weight: .semibold))
                            .foregroundStyle(StudioPalette.foreground)
                    }
                    StudioCalloutBlock(
                        title: "",
                        text: analysis.discourse?.cohesion ?? "暂无分析",
                        accent: .violet,
                        enclosedBox: true
                    )
                }
            }

            if let notes = analysis.notes, !notes.isEmpty {
                StudioSurfaceCard(leftStripe: .amber, tint: .amber, padding: 16, spacing: 6) {
                    Text("交流场景与语用提示 · PRAGMATIC REGISTER")
                        .font(StudioFont.ui(size: 10.5, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(StudioAccent.amber.text)
                    Text(notes)
                        .font(StudioFont.ui(size: 12.5))
                        .foregroundStyle(StudioPalette.foreground.opacity(0.88))
                        .lineSpacing(3)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let upgraded = analysis.discourse?.upgradedParagraph, !upgraded.isEmpty {
                StudioSurfaceCard(topStripe: .solid(.emerald), padding: 18, spacing: 12) {
                    LessonDetailFlowLayout(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("扩展练习 · Extended Paragraph")
                                .font(StudioFont.ui(size: 13.5, weight: .semibold))
                                .foregroundStyle(StudioPalette.foreground)
                            Text("围绕原话题练习自然表达，可能引入假设情境；不是原文翻译。")
                                .font(StudioFont.ui(size: 11.5))
                                .foregroundStyle(StudioPalette.mutedForeground)
                        }
                        HStack(spacing: 6) {
                            StudioDetailListenButton(speech: store.speech, api: store.api,
                                                     remote: store.activeSpeechID != nil,
                                                     text: upgraded, helpText: "朗读扩展练习")
                            StudioActionButton(
                                label: copiedParagraph ? "Copied" : "Copy",
                                icon: copiedParagraph ? "checkmark" : "doc.on.doc",
                                variant: .ghost,
                                small: true
                            ) {
                                copyText(upgraded, flag: $copiedParagraph, token: $paragraphCopyToken)
                            }
                        }
                    }

                    Text(verbatim: upgraded)
                        .font(StudioFont.editorial(size: 15.5, weight: .medium))
                        .foregroundStyle(StudioPalette.foreground)
                        .lineSpacing(4.5)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)

                    if let chinese = analysis.discourse?.upgradedChinese, !chinese.isEmpty {
                        StudioCalloutBlock(title: "", text: chinese, accent: .emerald)
                    }
                }
            }
        }
    }

    // MARK: - Tab 4: 实战举一反三 (Practice Examples)

    @ViewBuilder
    private func examplesTab(analysis: LessonAnalysis) -> some View {
        let examples = analysis.examples ?? []
        if examples.isEmpty {
            emptySectionCard(text: "暂无实战例句。")
        } else {
            LessonDetailGrid(maxColumns: 3, spacing: 16) {
                ForEach(Array(examples.enumerated()), id: \.offset) { idx, ex in
                    StudioSurfaceCard(padding: 18, spacing: 11) {
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 7) {
                                StudioBadge(
                                    text: String(format: "EXAMPLE %02d", idx + 1),
                                    style: .accent(.teal),
                                    monospaced: true
                                )
                                Text(verbatim: ex.english)
                                    .font(StudioFont.editorial(size: 15.5, weight: .semibold))
                                    .foregroundStyle(StudioPalette.foreground)
                                    .lineSpacing(3.5)
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 4)
                            HStack(spacing: 4) {
                                StudioFavoriteStarButton(
                                    store: store,
                                    term: ex.english,
                                    meaning: ex.chinese ?? "",
                                    category: "example",
                                    eventID: lesson.id
                                )
                                SpeechButton(
                                    speech: store.speech,
                                    api: store.api,
                                    remote: store.activeSpeechID != nil,
                                    text: ex.english
                                )
                            }
                        }

                        if let chinese = ex.chinese, !chinese.isEmpty {
                            StudioCalloutBlock(title: "", text: chinese, accent: .teal)
                        }

                        if let note = ex.note, !note.isEmpty {
                            Text(note)
                                .font(StudioFont.ui(size: 12))
                                .foregroundStyle(StudioPalette.mutedForeground)
                                .lineSpacing(2.5)
                                .textSelection(.enabled)
                        }

                        StudioExampleAttributionView(source: ex.source)
                    }
                }
            }
        }
    }

    private func emptySectionCard(text: String) -> some View {
        StudioSurfaceCard(hoverable: false) {
            Text(text)
                .font(StudioFont.ui(size: 12.5))
                .foregroundStyle(StudioPalette.mutedForeground)
        }
    }

    private func copyText(_ value: String, flag: Binding<Bool>, token: Binding<UUID>) {
        guard !value.isEmpty else { return }
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(value, forType: .string) else { return }
        let revision = UUID()
        token.wrappedValue = revision
        flag.wrappedValue = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
            guard token.wrappedValue == revision else { return }
            flag.wrappedValue = false
        }
    }
}

// MARK: - Detail-only adaptive layouts

/// Wrap metadata/actions at their natural width; long individual items still receive
/// the available width so translated labels and source titles remain readable.
private struct LessonDetailFlowLayout: Layout {
    var spacing: CGFloat = 8

    private func arrangement(width: CGFloat, subviews: Subviews) -> (CGSize, [CGRect]) {
        let width = max(1, width)
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0
        for view in subviews {
            let ideal = view.sizeThatFits(.unspecified)
            let size = view.sizeThatFits(ProposedViewSize(width: min(width, ideal.width), height: nil))
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            usedWidth = max(usedWidth, x + size.width)
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }
        return (CGSize(width: usedWidth, height: y + rowHeight), frames)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let idealWidth = subviews.reduce(CGFloat.zero) { $0 + $1.sizeThatFits(.unspecified).width }
            + CGFloat(max(0, subviews.count - 1)) * spacing
        return arrangement(width: proposal.width ?? idealWidth, subviews: subviews).0
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrangement(width: bounds.width, subviews: subviews).1
        for (view, frame) in zip(subviews, frames) {
            view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                       anchor: .topLeading, proposal: ProposedViewSize(frame.size))
        }
    }
}

/// Mirrors Web's 1 → 2 → 3/4 column progression using the detail container,
/// rather than the full window (which may also contain an expanded sidebar).
private struct LessonDetailGrid: Layout {
    var maxColumns: Int
    var intermediateColumns: Int = 2
    var spacing: CGFloat = 16

    private func arrangement(width: CGFloat, subviews: Subviews) -> (CGSize, [CGRect]) {
        let width = max(1, width)
        let target = width >= 1120 ? maxColumns : (width >= 600 ? min(maxColumns, intermediateColumns) : 1)
        let columns = max(1, min(target, subviews.count))
        let columnWidth = max(1, (width - CGFloat(columns - 1) * spacing) / CGFloat(columns))
        var frames: [CGRect] = []
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for (index, view) in subviews.enumerated() {
            if index > 0, index.isMultiple(of: columns) {
                y += rowHeight + spacing
                rowHeight = 0
            }
            let size = view.sizeThatFits(ProposedViewSize(width: columnWidth, height: nil))
            frames.append(CGRect(x: CGFloat(index % columns) * (columnWidth + spacing),
                                 y: y, width: columnWidth, height: size.height))
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: width, height: y + rowHeight), frames)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrangement(width: proposal.width ?? 600, subviews: subviews).0
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrangement(width: bounds.width, subviews: subviews).1
        for (view, frame) in zip(subviews, frames) {
            view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                       anchor: .topLeading, proposal: ProposedViewSize(frame.size))
        }
    }
}

private struct StudioDetailSpeechNotice: View {
    @ObservedObject var speech: SpeechController

    var body: some View {
        if let notice = speech.notice {
            Text(notice)
                .font(StudioFont.ui(size: 11, weight: .medium))
                .foregroundStyle(StudioAccent.amber.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct StudioDetailListenButton: View {
    @ObservedObject var speech: SpeechController
    let api: SidecarAPI
    let remote: Bool
    let text: String
    let helpText: String

    var body: some View {
        let playing = speech.currentText == text
        StudioActionButton(label: playing ? "Stop" : "Listen",
                           icon: playing ? "speaker.slash.fill" : "speaker.wave.2.fill",
                           iconColor: playing ? StudioPalette.destructive : StudioPalette.primary,
                           variant: .outline, small: true,
                           helpText: playing ? "停止朗读" : helpText) {
            speech.speak(text, api: api, remote: remote)
        }
        .accessibilityLabel(playing ? "停止朗读" : helpText)
    }
}

// MARK: - Inline Correction Card (Aligned with App.tsx lines 794-836)

private struct StudioCorrectionCard: View {
    let correction: Correction

    var body: some View {
        let isStyle = correction.kind == "style"
        let accent: StudioAccent = isStyle ? .violet : .amber
        let badgeLabel: String = {
            if isStyle {
                return "风格升格 · Style Upgrade（不表示原句有错）"
            }
            if correction.kind == "correction" {
                return "语言纠错 · Grammar & Lexical Fix"
            }
            return "表达对比 · Expression Refinement"
        }()

        VStack(alignment: .leading, spacing: 9) {
            StudioBadge(text: badgeLabel, style: .accent(accent))

            LessonDetailFlowLayout(spacing: 8) {
                Text(verbatim: correction.before)
                    .font(StudioFont.phonetic(size: 12, weight: .medium))
                    .foregroundStyle(StudioAccent.rose.text)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4.5)
                    .background(StudioAccent.rose.badgeFill, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(StudioAccent.rose.badgeBorder, lineWidth: 1)
                    )
                    .textSelection(.enabled)

                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(StudioPalette.mutedForeground)

                Text(verbatim: correction.after)
                    .font(StudioFont.phonetic(size: 12, weight: .semibold))
                    .foregroundStyle(StudioAccent.emerald.text)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4.5)
                    .background(StudioAccent.emerald.badgeFill, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(StudioAccent.emerald.badgeBorder, lineWidth: 1)
                    )
                    .textSelection(.enabled)
            }

            if let reason = correction.reason, !reason.isEmpty {
                HStack(alignment: .top, spacing: 0) {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(StudioPalette.borderStrong)
                        .frame(width: 2)
                    Text(reason)
                        .font(StudioFont.ui(size: 12))
                        .foregroundStyle(StudioPalette.mutedForeground)
                        .lineSpacing(2.5)
                        .padding(.leading, 8)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.surfaceFill, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .strokeBorder(accent.surfaceBorder, lineWidth: 1)
        )
    }
}

// MARK: - Vocabulary Card & Details (Aligned with App.tsx & vocabulary-details.tsx)

private struct StudioVocabularyCard: View {
    @ObservedObject var store: DesktopStore
    let eventID: String
    let word: Vocabulary
    let singleColumnExpanded: Bool
    @ObservedObject var speech: SpeechController
    let api: SidecarAPI
    let remoteTTS: Bool
    @State private var relationTab: String = "synonyms"

    var body: some View {
        StudioSurfaceCard(topStripe: .lexisGradient, padding: 18, spacing: 11) {
            // Header: Headword + POS Badge + Phonetic + Speak Button
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 5) {
                    LessonDetailFlowLayout(spacing: 7) {
                        Text(verbatim: word.term)
                            .font(StudioFont.editorial(size: 18.5, weight: .bold))
                            .foregroundStyle(StudioPalette.foreground)
                            .textSelection(.enabled)

                        if let pos = word.pos, !pos.isEmpty {
                            StudioBadge(text: pos, style: .accent(StudioAccent.forPOS(pos)))
                        }
                    }

                    if let phonetic = word.phonetic, !phonetic.isEmpty {
                        Text(verbatim: phonetic)
                            .font(StudioFont.phonetic(size: 11))
                            .foregroundStyle(StudioPalette.mutedForeground)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(StudioPalette.muted, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                            .textSelection(.enabled)
                    }
                }

                Spacer(minLength: 4)

                HStack(spacing: 4) {
                    StudioFavoriteStarButton(
                        store: store,
                        term: word.term,
                        meaning: word.meaning,
                        category: "vocabulary",
                        eventID: eventID
                    )
                    SpeechButton(speech: speech, api: api, remote: remoteTTS, text: word.term)
                }
            }

            // Core Callout Blocks
            if singleColumnExpanded {
                LessonDetailGrid(maxColumns: 2, spacing: 10) {
                    coreCalloutBlocks
                }
            } else {
                VStack(alignment: .leading, spacing: 9) {
                    coreCalloutBlocks
                }
            }

            // Extended VocabularyDetails (Senses, Examples, Word Family, Synonyms/Antonyms)
            vocabularyExtendedDetails
        }
    }

    @ViewBuilder
    private var coreCalloutBlocks: some View {
        StudioCalloutBlock(title: "核心释义", text: word.meaning, accent: .indigo)

        if let morphology = word.morphology, !morphology.isEmpty {
            StudioCalloutBlock(title: "字源构词", text: morphology, accent: .amber)
        }

        if let nuance = word.nuance, !nuance.isEmpty {
            StudioCalloutBlock(title: "词义辨析", text: nuance, accent: .violet)
        }

        if let usage = word.usage, !usage.isEmpty {
            StudioCalloutBlock(title: "常用搭配", text: usage, accent: .emerald, monospacedText: true, enclosedBox: true)
        }
    }

    @ViewBuilder
    private var vocabularyExtendedDetails: some View {
        let senses = word.senses ?? []
        let examples = word.examples ?? []
        let family = word.wordFamily ?? []
        let hasRelations = word.synonyms != nil || word.antonyms != nil

        if !senses.isEmpty {
            Divider().overlay(StudioPalette.border.opacity(0.6))
            VStack(alignment: .leading, spacing: 8) {
                Text("词性与释义")
                    .font(StudioFont.ui(size: 11.5, weight: .semibold))
                    .foregroundStyle(StudioPalette.foreground)

                ForEach(Array(senses.enumerated()), id: \.offset) { _, sense in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            if let pos = sense.pos, !pos.isEmpty {
                                Text(pos)
                                    .font(StudioFont.ui(size: 11.5, weight: .semibold))
                                    .foregroundStyle(StudioPalette.mutedForeground)
                            }
                            Text(sense.meaning)
                                .font(StudioFont.ui(size: 12))
                                .foregroundStyle(StudioPalette.foreground)
                                .lineSpacing(2.5)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let ex = sense.example {
                            StudioNestedExampleView(store: store, eventID: eventID, example: ex, speech: speech, api: api, remoteTTS: remoteTTS)
                        }
                    }
                }
            }
        }

        if !examples.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("用法例句")
                    .font(StudioFont.ui(size: 11.5, weight: .semibold))
                    .foregroundStyle(StudioPalette.foreground)
                ForEach(Array(examples.enumerated()), id: \.offset) { _, ex in
                    StudioNestedExampleView(store: store, eventID: eventID, example: ex, speech: speech, api: api, remoteTTS: remoteTTS)
                }
            }
        }

        if !family.isEmpty {
            Divider().overlay(StudioPalette.border.opacity(0.6))
            VStack(alignment: .leading, spacing: 8) {
                Text("同源词派生 · Word Family")
                    .font(StudioFont.ui(size: 11.5, weight: .semibold))
                    .foregroundStyle(StudioPalette.foreground)
                StudioRelatedWordList(store: store, eventID: eventID, words: family, contrast: false, speech: speech, api: api, remoteTTS: remoteTTS)
            }
        }

        if hasRelations {
            Divider().overlay(StudioPalette.border.opacity(0.6))
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    StudioSegmentedTabs(
                        selection: $relationTab,
                        options: [
                            StudioTabOption(id: "synonyms", title: "同义词"),
                            StudioTabOption(id: "antonyms", title: "反义词")
                        ],
                        fullWidth: false,
                        compact: true
                    )
                    Spacer()
                }

                if relationTab == "synonyms" {
                    let list = word.synonyms ?? []
                    if !list.isEmpty {
                        StudioRelatedWordList(store: store, eventID: eventID, words: list, contrast: true, speech: speech, api: api, remoteTTS: remoteTTS)
                    } else {
                        Text("暂无适合当前词义的同义词；可先结合例句理解用法。")
                            .font(StudioFont.ui(size: 11.5))
                            .foregroundStyle(StudioPalette.mutedForeground)
                    }
                } else {
                    let list = word.antonyms ?? []
                    if !list.isEmpty {
                        StudioRelatedWordList(store: store, eventID: eventID, words: list, contrast: true, speech: speech, api: api, remoteTTS: remoteTTS)
                    } else {
                        Text("暂无适合当前词义的直接反义词；可先结合例句理解用法。")
                            .font(StudioFont.ui(size: 11.5))
                            .foregroundStyle(StudioPalette.mutedForeground)
                    }
                }
            }
        }
    }
}

private struct StudioRelatedWordList: View {
    @ObservedObject var store: DesktopStore
    let eventID: String
    let words: [RelatedWord]
    let contrast: Bool
    @ObservedObject var speech: SpeechController
    let api: SidecarAPI
    let remoteTTS: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(words.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 6) {
                        VStack(alignment: .leading, spacing: 4) {
                            LessonDetailFlowLayout(spacing: 6) {
                                Text(verbatim: item.term)
                                    .font(StudioFont.ui(size: 12.5, weight: .semibold))
                                    .foregroundStyle(StudioPalette.foreground)
                                if let phonetic = item.phonetic, !phonetic.isEmpty {
                                    Text(verbatim: phonetic)
                                        .font(StudioFont.phonetic(size: 11))
                                        .foregroundStyle(StudioPalette.mutedForeground)
                                }
                                if let pos = item.pos, !pos.isEmpty {
                                    Text(pos)
                                        .font(StudioFont.ui(size: 11, weight: .medium))
                                        .foregroundStyle(StudioPalette.mutedForeground)
                                }
                            }
                            Text(item.meaning)
                                .font(StudioFont.ui(size: 12))
                                .foregroundStyle(StudioPalette.foreground.opacity(0.86))
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        StudioFavoriteStarButton(store: store, term: item.term, meaning: item.meaning,
                                                 category: "vocabulary", eventID: eventID)
                        SpeechButton(speech: speech, api: api, remote: remoteTTS, text: item.term)
                    }

                    if let rel = item.relationship, !rel.isEmpty {
                        Text(rel)
                            .font(StudioFont.ui(size: 11.5))
                            .foregroundStyle(StudioPalette.mutedForeground)
                    }

                    if contrast, let diff = item.difference, !diff.isEmpty {
                        Text("区别：\(diff)")
                            .font(StudioFont.ui(size: 11.5))
                            .foregroundStyle(StudioPalette.foreground.opacity(0.86))
                    }

                    if let ex = item.example {
                        StudioNestedExampleView(store: store, eventID: eventID, example: ex, speech: speech, api: api, remoteTTS: remoteTTS)
                    }
                }
            }
        }
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct StudioNestedExampleView: View {
    @ObservedObject var store: DesktopStore
    let eventID: String
    let example: Example
    @ObservedObject var speech: SpeechController
    let api: SidecarAPI
    let remoteTTS: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            RoundedRectangle(cornerRadius: 1)
                .fill(StudioPalette.borderStrong)
                .frame(width: 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .top, spacing: 4) {
                    Text(verbatim: example.english)
                        .font(StudioFont.ui(size: 12))
                        .foregroundStyle(StudioPalette.foreground)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    StudioFavoriteStarButton(store: store, term: example.english, meaning: example.chinese ?? "",
                                             category: "example", eventID: eventID)
                    SpeechButton(speech: speech, api: api, remote: remoteTTS, text: example.english)
                }
                if let zh = example.chinese, !zh.isEmpty {
                    Text(zh)
                        .font(StudioFont.ui(size: 11.5))
                        .foregroundStyle(StudioPalette.mutedForeground)
                        .textSelection(.enabled)
                }
                if let note = example.note, !note.isEmpty {
                    Text(note)
                        .font(StudioFont.ui(size: 11.5))
                        .foregroundStyle(StudioPalette.mutedForeground)
                }
                StudioExampleAttributionView(source: example.source)
            }
            .padding(.leading, 9)
        }
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct StudioExampleAttributionView: View {
    let source: ExampleSource?

    var body: some View {
        LessonDetailFlowLayout(spacing: 4) {
            if source?.kind == "ai" {
                Text("AI 原创例句")
            } else if source?.kind == "reference" {
                let title = source?.title.flatMap { $0.isEmpty ? nil : " · \($0)" } ?? ""
                Text("引用来源待核实\(title)")
                if let raw = source?.url,
                   let url = URL(string: raw),
                   ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
                   let host = url.host, !host.isEmpty,
                   url.user == nil, url.password == nil {
                    Text("·")
                    Link("查看出处", destination: url)
                        .underline()
                }
            } else {
                Text("来源未记录")
            }
        }
        .font(StudioFont.ui(size: 10.5))
        .foregroundStyle(StudioPalette.mutedForeground)
    }
}

// MARK: - Shared Lesson Actions & Speech Button

struct LessonActions: View {
    @ObservedObject var store: DesktopStore
    let text: String
    @State private var copied = false

    var body: some View {
        HStack(spacing: 10) {
            SpeechButton(speech: store.speech, api: store.api, remote: store.activeSpeechID != nil, text: text)
            Button {
                NSPasteboard.general.clearContents()
                guard NSPasteboard.general.setString(text, forType: .string) else { return }
                copied = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { copied = false }
            } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11.5, weight: .medium))
            }
            .buttonStyle(.borderless)
            .help("复制英文表达")
            .accessibilityLabel(copied ? "已复制英文表达" : "复制英文表达")
            .disabled(text.isEmpty)
        }
    }
}

struct SpeechButton: View {
    @ObservedObject var speech: SpeechController
    let api: SidecarAPI
    let remote: Bool
    let text: String
    @State private var hovering = false

    var body: some View {
        let isPlaying = speech.currentText == text
        Button {
            speech.speak(text, api: api, remote: remote)
        } label: {
            Image(systemName: isPlaying ? "stop.fill" : "speaker.wave.2")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(isPlaying ? StudioPalette.destructive : (hovering ? StudioPalette.primary : StudioPalette.mutedForeground))
                .frame(width: 24, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(hovering ? StudioPalette.muted : Color.clear)
                )
        }
        .buttonStyle(.plain)
        .disabled(text.isEmpty)
        .onHover { hovering = $0 }
        .help(isPlaying ? "停止朗读" : "朗读英文")
        .accessibilityLabel(isPlaying ? "停止朗读" : "朗读英文：\(text)")
    }
}

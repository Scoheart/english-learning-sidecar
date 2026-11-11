import SwiftUI
import AppKit
import SidecarCore

struct LessonDetail: View {
    @ObservedObject var store: DesktopStore
    let lesson: Lesson
    @State private var tab = "words"
    @State private var deleting = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Label(lesson.sourceName, systemImage: "sparkle").font(.caption.weight(.medium))
                    Text(statusLabel(lesson.status)).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(role: .destructive) { deleting = true } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("删除此记录")
                }
                if let analysis = lesson.analysis, lesson.status == "complete" {
                    NativeCard {
                        HStack { Text("自然表达").font(.caption).foregroundStyle(.secondary); Spacer(); LessonActions(store: store, text: analysis.translation ?? "") }
                        Text(analysis.translation ?? "未提供英文表达").font(.system(size: 25, weight: .semibold)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        if let summary = analysis.summary, !summary.isEmpty { Text(summary).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                    }
                    DisclosureGroup("原始提问") { Text(lesson.content).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled).padding(.top, 8) }.font(.callout)
                    if let corrections = analysis.corrections, !corrections.isEmpty {
                        NativeCard {
                            Text("纠错与表达优化").font(.headline)
                            ForEach(Array(corrections.enumerated()), id: \.offset) { _, item in
                                Text(item.before).strikethrough().foregroundStyle(.secondary).textSelection(.enabled)
                                Text(item.after).fontWeight(.medium).textSelection(.enabled)
                                if let reason = item.reason { Text(reason).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                            }
                        }
                    }
                    Picker("讲解维度", selection: $tab) {
                        Text("字与词").tag("words"); Text("句法").tag("sentence"); Text("篇章").tag("discourse"); Text("例句").tag("examples")
                    }.pickerStyle(.segmented)
                    switch tab {
                    case "sentence":
                        NativeCard {
                            InfoBlock(title: "基本句型", text: analysis.sentenceAnatomy?.pattern)
                            InfoBlock(title: "时态", text: analysis.sentenceAnatomy?.tense)
                            InfoBlock(title: "语态", text: analysis.sentenceAnatomy?.voice)
                            ForEach(Array((analysis.sentenceAnatomy?.constituents ?? []).enumerated()), id: \.offset) { _, part in
                                Divider(); InfoBlock(title: part.role, text: part.fragment); Text(part.explanation).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                            }
                            ForEach(Array((analysis.grammar ?? []).enumerated()), id: \.offset) { _, grammar in
                                Divider(); InfoBlock(title: grammar.label, text: grammar.explanation)
                            }
                            if analysis.sentenceAnatomy == nil && (analysis.grammar ?? []).isEmpty { Text("这条记录没有句法讲解。").foregroundStyle(.secondary) }
                        }
                    case "discourse":
                        NativeCard {
                            if let discourse = analysis.discourse {
                                InfoBlock(title: "逻辑", text: discourse.logic)
                                InfoBlock(title: "衔接", text: discourse.cohesion)
                                InfoBlock(title: "进阶表达", text: discourse.upgradedParagraph)
                                InfoBlock(title: "中文释义", text: discourse.upgradedChinese)
                                if let text = discourse.upgradedParagraph { LessonActions(store: store, text: text) }
                            } else { Text("这条记录没有篇章分析。").foregroundStyle(.secondary) }
                        }
                    case "examples":
                        if (analysis.examples ?? []).isEmpty { Text("暂无例句。").foregroundStyle(.secondary) }
                        ForEach(Array((analysis.examples ?? []).enumerated()), id: \.offset) { _, example in
                            NativeCard { Text(example.english).font(.title3).textSelection(.enabled); InfoBlock(title: "释义", text: example.chinese); LessonActions(store: store, text: example.english) }
                        }
                    default:
                        if (analysis.vocabulary ?? []).isEmpty { Text("这条记录没有词汇讲解。").foregroundStyle(.secondary) }
                        ForEach(Array((analysis.vocabulary ?? []).enumerated()), id: \.offset) { _, word in
                            NativeCard {
                                HStack { Text(word.term).font(.title3.weight(.semibold)); if let pos = word.pos { Text(pos).foregroundStyle(.secondary) }; Spacer(); SpeechButton(speech: store.speech, api: store.api, remote: store.activeSpeechID != nil, text: word.term) }
                                InfoBlock(title: "发音", text: word.phonetic)
                                Text(word.meaning).textSelection(.enabled)
                                InfoBlock(title: "词形与构词", text: word.morphology)
                                InfoBlock(title: "搭配", text: word.usage)
                                InfoBlock(title: "语境差异", text: word.nuance)
                            }
                        }
                    }
                    if let notes = analysis.notes { Text(notes).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                } else {
                    Text(lesson.content).font(.title3).textSelection(.enabled)
                    if lesson.status == "failed" {
                        Label(lesson.error ?? "分析失败", systemImage: "exclamationmark.circle").foregroundStyle(.secondary)
                        Button("重试分析") { Task { await store.mutate("/api/events/\(lesson.id)/retry") } }
                    } else if lesson.status == "skipped" {
                        Text("输入已被过滤；没有产生英语讲解。").foregroundStyle(.secondary)
                    } else { ProgressView("等待学习引擎生成讲解…").padding(.vertical) }
                }
            }.padding(28).frame(maxWidth: 900, alignment: .leading).frame(maxWidth: .infinity)
        }
        .onAppear { if lesson.status == "complete" { store.markRead(lesson.id) } }
        .onChange(of: lesson.status) { value in if value == "complete" { store.markRead(lesson.id) } }
        .confirmationDialog("删除这条学习记录？此操作会影响共享学习服务。", isPresented: $deleting) {
            Button("删除记录", role: .destructive) {
                Task { if await store.mutate("/api/events/\(lesson.id)", method: "DELETE") { store.selectedID = nil } }
            }
        }
    }
}
struct LessonActions: View {
    @ObservedObject var store: DesktopStore
    let text: String
    @State private var copied = false
    var body: some View {
        HStack(spacing: 14) {
            SpeechButton(speech: store.speech, api: store.api, remote: store.activeSpeechID != nil, text: text)
            Button { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string); copied = true } label: {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
            }.buttonStyle(.borderless).help("复制英文表达").disabled(text.isEmpty)
        }
    }
}
struct SpeechButton: View {
    @ObservedObject var speech: SpeechController
    let api: SidecarAPI
    let remote: Bool
    let text: String
    var body: some View {
        Button { speech.speak(text, api: api, remote: remote) } label: {
            Image(systemName: speech.currentText == text ? "stop.fill" : "speaker.wave.2")
        }.buttonStyle(.borderless).disabled(text.isEmpty)
        .help(speech.currentText == text ? "停止朗读" : "朗读英文")
        .accessibilityLabel(speech.currentText == text ? "停止朗读" : "朗读英文")
    }
}

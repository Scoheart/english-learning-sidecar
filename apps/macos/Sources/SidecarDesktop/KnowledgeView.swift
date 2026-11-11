import SwiftUI
import SidecarCore

struct KnowledgeView: View {
    @ObservedObject var store: DesktopStore
    let query: String
    private var items: [Knowledge] { store.knowledge.filter { query.isEmpty || "\($0.term) \($0.meaning)".localizedCaseInsensitiveContains(query) } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("知识库").font(.largeTitle.weight(.semibold))
                Text("从日常提问中积累的词汇和句型。出现次数不代表掌握程度。").foregroundStyle(.secondary)
                if items.isEmpty { ContentUnavailableView("还没有知识点", systemImage: "books.vertical", description: Text("完成一次分析后，知识点会自动保存在学习服务中。")) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), alignment: .top)], alignment: .leading, spacing: 16) {
                    ForEach(items) { item in
                        NativeCard {
                            HStack { Text(item.category == "vocabulary" ? "词汇" : "语法").font(.caption).foregroundStyle(.secondary); Spacer(); Text("出现 \(item.encounters) 次").font(.caption).foregroundStyle(.secondary) }
                            Text(item.term).font(.title3.weight(.semibold)).textSelection(.enabled)
                            Text(item.meaning).font(.callout).textSelection(.enabled)
                            SpeechButton(speech: store.speech, api: store.api, remote: store.activeSpeechID != nil, text: item.term)
                        }
                    }
                }
            }.padding(28)
        }
    }
}

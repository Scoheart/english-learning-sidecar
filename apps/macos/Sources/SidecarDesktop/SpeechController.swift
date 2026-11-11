import AVFoundation
import Combine
import SidecarCore

@MainActor final class SpeechController: NSObject, ObservableObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    @Published private(set) var currentText: String?
    @Published private(set) var loading = false
    @Published private(set) var notice: String?
    private let synthesizer = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var task: Task<Void, Never>?
    private var generation = UUID()
    override init() { super.init(); synthesizer.delegate = self }
    func stop() {
        generation = UUID(); task?.cancel(); task = nil
        player?.stop(); player = nil; synthesizer.stopSpeaking(at: .immediate)
        currentText = nil; loading = false
    }
    func speak(_ text: String, api: SidecarAPI, remote: Bool) {
        if currentText == text { stop(); return }
        stop(); notice = nil
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        currentText = clean; let identity = generation
        task = Task {
            if remote {
                loading = true
                do {
                    let data = try await api.data("/api/tts", method: "POST", body: ["input": clean])
                    try Task.checkCancellation()
                    guard identity == generation else { return }
                    let next = try AVAudioPlayer(data: data); next.delegate = self; player = next
                    loading = false
                    guard next.play() else { throw SidecarError.invalidResponse }
                    return
                } catch {
                    guard !Task.isCancelled, identity == generation else { return }
                    notice = "模型语音不可用，已切换到系统语音。"
                }
            }
            guard identity == generation else { return }
            loading = false
            let utterance = AVSpeechUtterance(string: clean)
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
            synthesizer.speak(utterance)
        }
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, self.player === player else { return }
            self.currentText = nil; self.player = nil
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            guard let self, !self.synthesizer.isSpeaking, self.player == nil, !self.loading else { return }
            self.currentText = nil
        }
    }
}

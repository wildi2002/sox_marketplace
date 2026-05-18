import librosa
import librosa.display
import matplotlib.pyplot as plt
import numpy as np

def analyze_audio_quality(file_path, output_path):
    # 1. Audio laden
    y, sr = librosa.load(file_path)

    # 2. Spektraler Kontrast (ähnlich wie dein Laplacian-Ansatz beim Bild)
    # Er berechnet den Unterschied zwischen Spitzen und Tälern im Spektrum
    S = np.abs(librosa.stft(y))
    contrast = librosa.feature.spectral_contrast(S=S, sr=sr)

    # 3. Visualisierung
    plt.figure(figsize=(10, 4))
    librosa.display.specshow(contrast, x_axis='time')
    plt.colorbar(label='Spectral Contrast')
    plt.title(f'Quality Analysis: {file_path}')
    plt.tight_layout()
    plt.savefig(output_path)
    plt.close()

# Anwendung
analyze_audio_quality('./media_types/audio/starostin-comedy-cartoon-funny.mp3', './media_types/audio/starostin-comedy-cartoon-funny.png')
analyze_audio_quality('./media_types/audio/starostin-comedy-cartoon-funny_lowres.wav', './media_types/audio/starostin-comedy-cartoon-funny_lowres.png')
analyze_audio_quality('./media_types/audio/starostin-comedy-cartoon-funny_both.wav', './media_types/audio/starostin-comedy-cartoon-funny_both.png')
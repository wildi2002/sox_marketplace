import cv2
import numpy as np

def generate_ela_light_image(image_path, output_path='ela_result.jpg'):
    img = cv2.imread(image_path)
    if img is None: return
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Der Laplace-Filter erkennt Kanten und Details
    laplace = cv2.Laplacian(gray, cv2.CV_64F)
    
    # Absolute Werte nehmen und verstärken (wie bei echtem ELA)
    laplace_abs = np.uint8(np.absolute(laplace))
    
    # Verstärkung: Multipliziere das Ergebnis, damit man auch feine Fehler sieht
    enhanced_ela = cv2.multiply(laplace_abs, 10) 
    
    # Optional: Eine Heatmap daraus machen (sieht cooler aus für Reports)
    heatmap = cv2.applyColorMap(enhanced_ela, cv2.COLORMAP_JET)

    cv2.imwrite(output_path, heatmap)
    print(f"✅ ELA-Light Bild wurde gespeichert als: {output_path}")

generate_ela_light_image('./media_types/Igel.jpeg', './media_types/Igel_ela.jpeg')
generate_ela_light_image('./media_types/Igel_sox_preview.jpeg', './media_types/Igel_sox_preview_ela.jpeg')
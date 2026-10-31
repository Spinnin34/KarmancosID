package com.karmancos.identity.api;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.ImageInputStream;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Iterator;
import java.util.Locale;

@Component
public class ProfilePictureProcessor {
    public static final long MAX_UPLOAD_BYTES = 2L * 1024 * 1024;
    private static final int MAX_SOURCE_EDGE = 4096;
    private static final long MAX_SOURCE_PIXELS = 12_000_000L;
    private static final int OUTPUT_EDGE = 512;

    public ProcessedPicture process(MultipartFile upload) {
        if (upload == null || upload.isEmpty()) {
            throw invalid("Selecciona una imagen para tu foto de perfil.");
        }
        if (upload.getSize() > MAX_UPLOAD_BYTES) {
            throw invalid("La imagen no puede superar los 2 MB.");
        }

        try (InputStream source = upload.getInputStream();
             ImageInputStream imageInput = ImageIO.createImageInputStream(source)) {
            if (imageInput == null) throw invalid("No se pudo leer la imagen seleccionada.");
            Iterator<ImageReader> readers = ImageIO.getImageReaders(imageInput);
            if (!readers.hasNext()) throw invalid("Usa una imagen JPG o PNG válida.");

            ImageReader reader = readers.next();
            try {
                reader.setInput(imageInput, true, true);
                String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                boolean png = format.equals("png");
                if (!png && !format.equals("jpeg") && !format.equals("jpg")) {
                    throw invalid("Solo se admiten imágenes JPG o PNG.");
                }

                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE
                        || (long) width * height > MAX_SOURCE_PIXELS) {
                    throw invalid("La imagen debe medir como máximo 4096 × 4096 píxeles.");
                }

                BufferedImage original = reader.read(0);
                if (original == null) throw invalid("No se pudo procesar la imagen seleccionada.");
                try {
                    return normalize(original, png);
                } finally {
                    original.flush();
                }
            } finally {
                reader.dispose();
            }
        } catch (ResponseStatusException exception) {
            throw exception;
        } catch (IOException | RuntimeException exception) {
            throw invalid("La imagen no se pudo procesar. Prueba con un archivo JPG o PNG.");
        }
    }

    private ProcessedPicture normalize(BufferedImage original, boolean png) throws IOException {
        double scale = Math.min(1d, (double) OUTPUT_EDGE / Math.max(original.getWidth(), original.getHeight()));
        int width = Math.max(1, (int) Math.round(original.getWidth() * scale));
        int height = Math.max(1, (int) Math.round(original.getHeight() * scale));
        int imageType = png && original.getColorModel().hasAlpha()
                ? BufferedImage.TYPE_INT_ARGB
                : BufferedImage.TYPE_INT_RGB;
        BufferedImage normalized = new BufferedImage(width, height, imageType);
        try {
            Graphics2D graphics = normalized.createGraphics();
            try {
                graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
                graphics.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
                graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                graphics.drawImage(original, 0, 0, width, height, null);
            } finally {
                graphics.dispose();
            }

            String format = png ? "png" : "jpeg";
            try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (!ImageIO.write(normalized, format, output)) {
                    throw invalid("No se pudo optimizar la imagen seleccionada.");
                }
                if (output.size() > MAX_UPLOAD_BYTES) {
                    throw invalid("La imagen optimizada supera los 2 MB. Reduce su tamaño e inténtalo de nuevo.");
                }
                return new ProcessedPicture(output.toByteArray(), png ? "image/png" : "image/jpeg");
            }
        } finally {
            normalized.flush();
        }
    }

    private ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    public record ProcessedPicture(byte[] content, String contentType) {
        public ProcessedPicture {
            content = content.clone();
        }

        @Override
        public byte[] content() {
            return content.clone();
        }
    }
}

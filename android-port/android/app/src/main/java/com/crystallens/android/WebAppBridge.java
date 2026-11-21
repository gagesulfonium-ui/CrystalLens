package com.crystallens.android;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.util.Log;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * The {@code window.CLNative} JavaScript bridge.
 *
 * <p>Contract consumed by the web core (registered in {@link MainActivity}):
 * <pre>
 *   CLNative.getInfo()                       -> JSON string
 *   CLNative.toast(message)
 *   CLNative.setKeepScreenOn(on)
 *   CLNative.vibrate(milliseconds)
 *   CLNative.beginExport(fileName, mimeType, mode)   // mode: "share" | "save"
 *   CLNative.appendExportChunk(base64Chunk)          // repeated, chunk order preserved
 *   CLNative.endExport()                     -> JSON string {"ok":true,"uri":"content://..."}
 *   CLNative.abortExport()
 *   CLNative.openUrl(url)
 *   CLNative.exitApp()
 * </pre>
 *
 * <p>All file I/O happens on one dedicated single-thread executor so chunk order cannot be
 * reordered, and all {@link Intent} starts are posted to the UI thread.</p>
 */
public class WebAppBridge {

    /** Request code shared with {@link MainActivity#onActivityResult}. */
    public static final int REQ_CREATE_DOCUMENT = 1002;

    /** Directory under cacheDir that holds exports served by {@link CacheFileProvider}. */
    public static final String EXPORT_DIR = "exports";

    private static final String TAG = "CrystalLens";
    private static final long MAX_EXPORT_BYTES = 512L * 1024L * 1024L;

    private final MainActivity activity;
    private final ExecutorService io;
    private final String appVersion;
    private final long versionCode;

    // Export state. Mutated only on the single "cl-export-io" thread, except that
    // launchExportIntent() reads the captured copies after the future completed.
    private File exportFile;
    private OutputStream exportOut;
    private String exportName;
    private String exportMime;
    private String exportMode;
    private String exportError;
    private long exportBytes;
    private boolean exportActive;

    // ACTION_CREATE_DOCUMENT state; written on the UI thread, read by onActivityResult.
    private volatile File pendingSaveSource;
    private volatile String pendingSaveName;

    public WebAppBridge(MainActivity activity) {
        this.activity = activity;
        this.io = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "cl-export-io");
            t.setDaemon(true);
            return t;
        });

        String version = "1.1.0";
        long code = 110L;
        try {
            PackageInfo info = activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0);
            if (info.versionName != null && !info.versionName.isEmpty()) {
                version = info.versionName;
            }
            code = (Build.VERSION.SDK_INT >= 28) ? info.getLongVersionCode() : info.versionCode;
        } catch (Throwable t) {
            Log.w(TAG, "could not read package version, using defaults", t);
        }
        this.appVersion = version;
        this.versionCode = code;
    }

    // ---------------------------------------------------------------- info / UX -----

    @JavascriptInterface
    public String getInfo() {
        try {
            JSONObject info = new JSONObject();
            info.put("available", true);
            info.put("platform", "android");
            info.put("sdkInt", Build.VERSION.SDK_INT);
            info.put("model", Build.MODEL == null ? "" : Build.MODEL);
            info.put("appVersion", appVersion);
            info.put("versionCode", versionCode);
            return info.toString();
        } catch (Throwable t) {
            Log.e(TAG, "getInfo failed", t);
            return "{\"available\":true,\"platform\":\"android\",\"sdkInt\":" + Build.VERSION.SDK_INT
                    + ",\"model\":\"\",\"appVersion\":\"" + appVersion
                    + "\",\"versionCode\":" + versionCode + "}";
        }
    }

    @JavascriptInterface
    public void toast(final String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        final String text = message.length() > 400 ? message.substring(0, 400) : message;
        activity.runOnUiThread(() -> {
            try {
                Toast.makeText(activity, text, Toast.LENGTH_SHORT).show();
            } catch (Throwable ignored) {
                // Activity gone.
            }
        });
    }

    @JavascriptInterface
    public void setKeepScreenOn(final boolean on) {
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                if (on) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            } catch (Throwable t) {
                Log.w(TAG, "setKeepScreenOn failed", t);
            }
        });
    }

    @JavascriptInterface
    public void vibrate(final int milliseconds) {
        activity.runOnUiThread(() -> {
            try {
                Vibrator vibrator = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
                if (vibrator == null || !vibrator.hasVibrator()) {
                    return;
                }
                long duration = Math.max(1L, Math.min(2000L, (long) milliseconds));
                if (Build.VERSION.SDK_INT >= 26) {
                    vibrator.vibrate(VibrationEffect.createOneShot(
                            duration, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(duration);
                }
            } catch (Throwable t) {
                Log.w(TAG, "vibrate failed", t);
            }
        });
    }

    @JavascriptInterface
    public void openUrl(final String url) {
        if (url == null) {
            return;
        }
        final String trimmed = url.trim();
        activity.runOnUiThread(() -> {
            try {
                String lower = trimmed.toLowerCase(Locale.US);
                if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
                    Log.w(TAG, "openUrl rejected non-http(s) url: " + trimmed);
                    return;
                }
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(trimmed));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Throwable t) {
                Log.w(TAG, "openUrl failed for " + trimmed, t);
                showToast(activity.getString(R.string.no_app_for_link));
            }
        });
    }

    @JavascriptInterface
    public void exitApp() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 21) {
                    activity.finishAndRemoveTask();
                } else {
                    activity.finish();
                }
            } catch (Throwable t) {
                activity.finish();
            }
        });
    }

    // -------------------------------------------------------------------- export ----

    /**
     * Starts a chunked export. Returns true when the request was accepted (the contract in
     * docs/CONTRACT.md types this as boolean; callers that ignore the return value work too).
     */
    @JavascriptInterface
    public boolean beginExport(final String fileName, final String mimeType, final String mode) {
        final String safeName = sanitizeFileName(fileName);
        final String mime = (mimeType == null || mimeType.trim().isEmpty())
                ? guessMimeType(safeName) : mimeType.trim();
        final String resolvedMode = "save".equalsIgnoreCase(mode) ? "save" : "share";
        try {
            io.execute(() -> {
                try {
                    closeExport(true);
                    File directory = exportsDir();
                    File file = new File(directory, safeName);
                    if (file.exists() && !file.delete()) {
                        throw new IOException("cannot replace existing export " + safeName);
                    }
                    OutputStream out = new BufferedOutputStream(new FileOutputStream(file), 256 * 1024);
                    exportFile = file;
                    exportOut = out;
                    exportName = safeName;
                    exportMime = mime;
                    exportMode = resolvedMode;
                    exportError = null;
                    exportBytes = 0L;
                    exportActive = true;
                    Log.i(TAG, "beginExport name=" + safeName + " mime=" + mime + " mode=" + resolvedMode);
                } catch (Throwable t) {
                    Log.e(TAG, "beginExport failed", t);
                    exportError = describe(t);
                    exportActive = false;
                    closeExport(true);
                }
            });
            return true;
        } catch (Throwable t) {
            Log.e(TAG, "beginExport could not be queued", t);
            return false;
        }
    }

    @JavascriptInterface
    public void appendExportChunk(final String base64Chunk) {
        if (base64Chunk == null || base64Chunk.isEmpty()) {
            return;
        }
        final byte[] decoded;
        try {
            decoded = Base64.decode(base64Chunk, Base64.DEFAULT);
        } catch (Throwable t) {
            Log.e(TAG, "appendExportChunk: invalid base64", t);
            try {
                io.execute(() -> {
                    if (exportError == null) {
                        exportError = "invalid base64 chunk";
                    }
                });
            } catch (Throwable ignored) {
                // Executor gone.
            }
            return;
        }
        try {
            io.execute(() -> {
                try {
                    if (!exportActive || exportOut == null) {
                        if (exportError == null) {
                            exportError = "no active export";
                        }
                        return;
                    }
                    if (exportBytes + decoded.length > MAX_EXPORT_BYTES) {
                        exportError = "export exceeds " + (MAX_EXPORT_BYTES / (1024 * 1024)) + " MB";
                        return;
                    }
                    exportOut.write(decoded);
                    exportBytes += decoded.length;
                } catch (Throwable t) {
                    Log.e(TAG, "appendExportChunk failed", t);
                    if (exportError == null) {
                        exportError = describe(t);
                    }
                }
            });
        } catch (Throwable t) {
            Log.e(TAG, "appendExportChunk could not be queued", t);
        }
    }

    @JavascriptInterface
    public String endExport() {
        final Future<String> future;
        try {
            future = io.submit(this::finishExport);
        } catch (Throwable t) {
            Log.e(TAG, "endExport submit failed", t);
            return errorJson("export executor unavailable");
        }
        try {
            return future.get(120L, TimeUnit.SECONDS);
        } catch (Throwable t) {
            Log.e(TAG, "endExport timed out", t);
            return errorJson("export finalization timed out");
        }
    }

    @JavascriptInterface
    public void abortExport() {
        try {
            io.execute(() -> {
                try {
                    closeExport(true);
                } finally {
                    exportActive = false;
                    Log.i(TAG, "abortExport");
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "abortExport could not be queued", t);
        }
    }

    /** Runs on the single export thread. Flushes the file, then hands the Intent to the UI. */
    private String finishExport() {
        File finishedFile = null;
        String finishedName = null;
        String finishedMime = null;
        String finishedMode = null;
        try {
            boolean active = exportActive;
            if (exportOut != null) {
                try {
                    exportOut.flush();
                } catch (Throwable t) {
                    if (exportError == null) {
                        exportError = describe(t);
                    }
                }
                try {
                    exportOut.close();
                } catch (Throwable t) {
                    if (exportError == null) {
                        exportError = describe(t);
                    }
                }
                exportOut = null;
            }
            finishedFile = exportFile;
            finishedName = exportName;
            finishedMime = exportMime;
            finishedMode = exportMode;
            exportFile = null;
            exportActive = false;

            if (!active) {
                return errorJson(exportError != null ? exportError : "no active export");
            }
            if (exportError != null) {
                return errorJson(exportError);
            }
            if (finishedFile == null || !finishedFile.isFile()) {
                return errorJson("export file missing");
            }

            final Uri uri = CacheFileProvider.getUri(finishedName);
            final File fileRef = finishedFile;
            final String modeRef = finishedMode;
            final String mimeRef = finishedMime;
            final String nameRef = finishedName;
            activity.runOnUiThread(() -> launchExportIntent(modeRef, uri, mimeRef, nameRef, fileRef));

            Log.i(TAG, "endExport ok name=" + finishedName + " bytes=" + exportBytes
                    + " uri=" + uri);
            return okJson(uri.toString());
        } catch (Throwable t) {
            Log.e(TAG, "finishExport failed", t);
            closeExport(true);
            exportActive = false;
            return errorJson(describe(t));
        }
    }

    /** UI thread. "save" -> ACTION_CREATE_DOCUMENT (falls back to share); "share" -> share sheet. */
    private void launchExportIntent(String mode, Uri uri, String mime, String name, File sourceFile) {
        try {
            if (activity.isFinishing()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= 17 && activity.isDestroyed()) {
                return;
            }
            if ("save".equals(mode) && startCreateDocument(sourceFile, mime, name)) {
                showToast(activity.getString(R.string.choose_save_location));
                return;
            }
            shareContentUri(uri, mime, name);
        } catch (Throwable t) {
            Log.e(TAG, "launchExportIntent failed", t);
            showToast(activity.getString(R.string.export_failed));
        }
    }

    private boolean startCreateDocument(File sourceFile, String mime, String name) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        pendingSaveSource = sourceFile;
        pendingSaveName = name;
        try {
            activity.startActivityForResult(intent, REQ_CREATE_DOCUMENT);
            return true;
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "no ACTION_CREATE_DOCUMENT handler, falling back to share", e);
            pendingSaveSource = null;
            pendingSaveName = null;
            return false;
        } catch (Throwable t) {
            Log.w(TAG, "ACTION_CREATE_DOCUMENT failed, falling back to share", t);
            pendingSaveSource = null;
            pendingSaveName = null;
            return false;
        }
    }

    private void shareContentUri(Uri uri, String mime, String name) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_SUBJECT, name);
        send.setClipData(ClipData.newRawUri(name, uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            Intent chooser = Intent.createChooser(send, activity.getString(R.string.share_export));
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(chooser);
        } catch (Throwable t) {
            Log.e(TAG, "share failed", t);
            showToast(activity.getString(R.string.export_failed));
        }
    }

    /**
     * Called from {@code MainActivity.onActivityResult} on the UI thread.
     *
     * @return true when this bridge consumed the result.
     */
    public boolean handleActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_CREATE_DOCUMENT) {
            return false;
        }
        final File source = pendingSaveSource;
        final String name = pendingSaveName;
        pendingSaveSource = null;
        pendingSaveName = null;

        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            showToast(activity.getString(R.string.save_cancelled));
            return true;
        }
        final Uri target = data.getData();
        showToast(activity.getString(R.string.saving));
        io.execute(() -> {
            try {
                if (source == null || !source.isFile()) {
                    throw new IOException("source export file is gone");
                }
                copyToUri(source, target);
                Log.i(TAG, "export saved to " + target);
                final String saved = activity.getString(R.string.saved_ok);
                activity.runOnUiThread(() -> showToast(saved));
            } catch (Throwable t) {
                Log.e(TAG, "save-to-document failed, falling back to share", t);
                final String fallbackName = name == null ? "crystallens-export.bin" : name;
                final Uri fallbackUri = CacheFileProvider.getUri(fallbackName);
                final String fallbackMime = guessMimeType(fallbackName);
                activity.runOnUiThread(() -> {
                    showToast(activity.getString(R.string.save_failed_fallback_share));
                    shareContentUri(fallbackUri, fallbackMime, fallbackName);
                });
            }
        });
        return true;
    }

    private void copyToUri(File source, Uri target) throws IOException {
        InputStream input = null;
        OutputStream output = null;
        try {
            input = new FileInputStream(source);
            output = activity.getContentResolver().openOutputStream(target, "w");
            if (output == null) {
                throw new IOException("cannot open destination " + target);
            }
            byte[] buffer = new byte[64 * 1024];
            int read;
            long total = 0L;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
                total += read;
            }
            output.flush();
            Log.i(TAG, "copied " + total + " bytes to " + target);
        } finally {
            closeQuietly(input);
            closeQuietly(output);
        }
    }

    // -------------------------------------------------------------- bridge teardown --

    public void destroy() {
        try {
            io.execute(() -> closeExport(false));
        } catch (Throwable ignored) {
            // Executor already shut down.
        }
        io.shutdown();
        try {
            if (!io.awaitTermination(2L, TimeUnit.SECONDS)) {
                io.shutdownNow();
            }
        } catch (InterruptedException e) {
            io.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    // -------------------------------------------------------------------- helpers ----

    private File exportsDir() throws IOException {
        File dir = new File(activity.getCacheDir(), EXPORT_DIR);
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) {
            throw new IOException("cannot create export directory " + dir);
        }
        return dir;
    }

    /** Must run on the export thread. */
    private void closeExport(boolean deleteFile) {
        if (exportOut != null) {
            try {
                exportOut.flush();
            } catch (Throwable ignored) {
                // Closing anyway.
            }
            try {
                exportOut.close();
            } catch (Throwable ignored) {
                // Closing anyway.
            }
            exportOut = null;
        }
        if (deleteFile) {
            File file = exportFile;
            exportFile = null;
            if (file != null && file.exists()) {
                if (!file.delete()) {
                    Log.w(TAG, "could not delete export file " + file);
                }
            }
        }
    }

    private void showToast(final String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Toast.makeText(activity, message, Toast.LENGTH_SHORT).show();
            } catch (Throwable ignored) {
                // Activity gone.
            }
        });
    }

    static String sanitizeFileName(String name) {
        String trimmed = (name == null) ? "" : name.trim();
        if (trimmed.isEmpty()) {
            return "crystallens-export.bin";
        }
        StringBuilder builder = new StringBuilder(trimmed.length());
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            if (c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"'
                    || c == '<' || c == '>' || c == '|' || c < 0x20) {
                builder.append('_');
            } else {
                builder.append(c);
            }
        }
        String result = builder.toString().trim();
        while (result.startsWith(".")) {
            result = result.substring(1);
        }
        if (result.isEmpty()) {
            return "crystallens-export.bin";
        }
        if (result.length() > 120) {
            String extension = "";
            int dot = result.lastIndexOf('.');
            if (dot > 0 && result.length() - dot <= 16) {
                extension = result.substring(dot);
            }
            result = result.substring(0, Math.max(1, 120 - extension.length())) + extension;
        }
        return result;
    }

    static String guessMimeType(String name) {
        if (name == null) {
            return "application/octet-stream";
        }
        int dot = name.lastIndexOf('.');
        String extension = (dot >= 0) ? name.substring(dot + 1).toLowerCase(Locale.US) : "";
        if ("cif".equals(extension)) {
            return "chemical/x-cif";
        }
        if ("xyz".equals(extension)) {
            return "chemical/x-xyz";
        }
        if ("vesta".equals(extension)) {
            return "application/octet-stream";
        }
        if ("txt".equals(extension)) {
            return "text/plain";
        }
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return (mime != null) ? mime : "application/octet-stream";
    }

    private static String describe(Throwable t) {
        if (t == null) {
            return "unknown error";
        }
        String message = t.getMessage();
        return t.getClass().getSimpleName()
                + (message == null || message.isEmpty() ? "" : ": " + message);
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (Throwable ignored) {
            // Nothing meaningful to do.
        }
    }

    private static String okJson(String uri) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", true);
            if (uri != null) {
                result.put("uri", uri);
            }
            return result.toString();
        } catch (Throwable t) {
            return "{\"ok\":true}";
        }
    }

    private static String errorJson(String error) {
        try {
            JSONObject result = new JSONObject();
            result.put("ok", false);
            result.put("error", error == null ? "unknown error" : error);
            return result.toString();
        } catch (Throwable t) {
            return "{\"ok\":false,\"error\":\"unknown error\"}";
        }
    }
}

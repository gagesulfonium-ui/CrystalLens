package com.crystallens.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * CrystalLens Android host.
 *
 * <p>Pure platform Java (no AndroidX): a full-screen immersive WebView shell that loads the
 * WebGL2 single-page app from {@code file:///android_asset/www/index.html} and exposes the
 * {@code window.CLNative} bridge implemented by {@link WebAppBridge}.</p>
 *
 * <p>Responsibilities: immersive window, WebView tuning, external-link interception, system
 * file chooser, ACTION_VIEW / ACTION_SEND shared-file ingestion, back-key delegation to the
 * web app, and keeping the JS side ignorant of all Android specifics.</p>
 */
public class MainActivity extends Activity {

    private static final String TAG = "CrystalLens";
    private static final String TAG_WEB = "CrystalLensWeb";

    /** Entry point of the bundled web core. */
    private static final String APP_URL = "file:///android_asset/www/index.html";

    /** Request codes. {@link #REQ_CREATE_DOCUMENT} is owned by the bridge. */
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_CREATE_DOCUMENT = WebAppBridge.REQ_CREATE_DOCUMENT;

    /** Hard cap for files handed to us through ACTION_VIEW / ACTION_SEND. */
    private static final long MAX_SHARED_BYTES = 8L * 1024L * 1024L;

    private static final int COLOR_BG = 0xFF020305;
    private static final int COLOR_ACCENT = 0xFF7FE3D6;
    private static final long BACK_EXIT_WINDOW_MS = 2000L;

    private WebView webView;
    private WebAppBridge bridge;
    private View splashView;
    private ExecutorService ioExecutor;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ArrayDeque<SharedFile> pendingShared = new ArrayDeque<>();
    private volatile boolean pageReady;
    private volatile boolean loadFailed;
    private ValueCallback<Uri[]> fileChooserCallback;
    private long lastBackPressAt;

    /** A shared file already read into memory and base64-encoded, waiting for the web core. */
    private static final class SharedFile {
        final String name;
        final String base64;

        SharedFile(String name, String base64) {
            this.name = name;
            this.base64 = base64;
        }
    }

    // ------------------------------------------------------------------ lifecycle ---

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Debuggable WebView for chrome://inspect while the app is under construction.
        WebView.setWebContentsDebuggingEnabled(true);

        // Screen stays on by default (it is a viewer); the web app may toggle it through
        // CLNative.setKeepScreenOn(false) when idle.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setupWindow();
        buildUi();

        bridge = new WebAppBridge(this);
        ioExecutor = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "cl-shared-io");
            t.setDaemon(true);
            return t;
        });

        configureWebView();
        webView.addJavascriptInterface(bridge, "CLNative");
        webView.loadUrl(APP_URL);

        ioExecutor.execute(this::cleanupStaleExports);

        // Cold start with a shared file (ACTION_VIEW / ACTION_SEND).
        handleIntent(getIntent());
        Log.i(TAG, "MainActivity created (sdk=" + Build.VERSION.SDK_INT + ", model=" + Build.MODEL + ")");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersiveMode();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) {
            bridge.destroy();
            bridge = null;
        }
        if (ioExecutor != null) {
            ioExecutor.shutdownNow();
            ioExecutor = null;
        }
        if (webView != null) {
            final WebView view = webView;
            webView = null;
            try {
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) {
                    parent.removeView(view);
                }
                view.stopLoading();
                view.setWebChromeClient(null);
                view.setWebViewClient(null);
                view.removeJavascriptInterface("CLNative");
                view.loadUrl("about:blank");
                view.clearHistory();
                view.destroy();
            } catch (Throwable t) {
                Log.w(TAG, "WebView teardown failed", t);
            }
        }
        super.onDestroy();
    }

    // -------------------------------------------------------------------- window ----

    private void setupWindow() {
        Window w = getWindow();
        w.setBackgroundDrawable(new ColorDrawable(COLOR_BG));
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        // Transparent bars so the WebGL canvas can run edge-to-edge.
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= 28) {
            try {
                WindowManager.LayoutParams lp = w.getAttributes();
                lp.layoutInDisplayCutoutMode =
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                w.setAttributes(lp);
            } catch (Throwable t) {
                Log.w(TAG, "cutout mode unavailable", t);
            }
            try {
                w.setNavigationBarDividerColor(Color.TRANSPARENT);
            } catch (Throwable ignored) {
                // API 28+ only; nothing to do.
            }
        }

        applyImmersiveMode();
    }

    private void applyImmersiveMode() {
        Window w = getWindow();
        if (w == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                w.setDecorFitsSystemWindows(false);
            } catch (Throwable ignored) {
                // Best effort only.
            }
            WindowInsetsController controller = w.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            View decor = w.getDecorView();
            if (decor != null) {
                decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_FULLSCREEN);
            }
        }
    }

    // ----------------------------------------------------------------------- ui -----

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_BG);

        webView = new WebView(this);
        webView.setBackgroundColor(COLOR_BG);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splashView = createSplashView();
        root.addView(splashView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
    }

    private View createSplashView() {
        FrameLayout box = new FrameLayout(this);
        box.setBackgroundColor(COLOR_BG);
        TextView title = new TextView(this);
        title.setText(getString(R.string.app_name));
        title.setTextColor(COLOR_ACCENT);
        title.setTextSize(24f);
        title.setLetterSpacing(0.16f);
        title.setGravity(Gravity.CENTER);
        box.addView(title, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return box;
    }

    private void hideSplash() {
        final View splash = splashView;
        if (splash == null) {
            return;
        }
        splashView = null;
        mainHandler.post(() -> {
            try {
                ViewGroup parent = (ViewGroup) splash.getParent();
                if (parent != null) {
                    parent.removeView(splash);
                }
            } catch (Throwable ignored) {
                // Already detached.
            }
        });
    }

    private void showLoadError(String detail) {
        loadFailed = true;
        hideSplash();
        mainHandler.post(() -> {
            final WebView view = webView;
            if (view == null || view.getParent() == null) {
                return;
            }
            ViewGroup parent = (ViewGroup) view.getParent();
            View previous = parent.findViewWithTag("cl-error");
            if (previous != null) {
                parent.removeView(previous);
            }
            TextView error = new TextView(this);
            error.setTag("cl-error");
            error.setText(getString(R.string.web_load_error,
                    detail == null || detail.isEmpty() ? "unknown error" : detail));
            error.setTextColor(0xFFE6F1F5);
            error.setTextSize(15f);
            error.setGravity(Gravity.CENTER);
            error.setPadding(56, 56, 56, 56);
            error.setBackgroundColor(COLOR_BG);
            parent.addView(error, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        });
    }

    // ------------------------------------------------------------------- webview ----

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // index.html is loaded from file:///android_asset/, which requires file access. For
        // targetSdk >= 30 the default is false, so it must be enabled explicitly.
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        // XHR/fetch from a file:// origin is gated by these on API < 30; harmless elsewhere.
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(false);

        // The web app owns all gestures (orbit / pinch / pan); WebView zoom stays off.
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setBlockNetworkLoads(false);

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setHapticFeedbackEnabled(false);
        webView.setLongClickable(false);
        webView.setBackgroundColor(COLOR_BG);

        webView.setWebViewClient(new ClWebViewClient());
        webView.setWebChromeClient(new ClWebChromeClient());
    }

    /** All navigations except our own asset entry point are intercepted. */
    private boolean handleNavigation(Uri uri) {
        if (uri == null) {
            return false;
        }
        String scheme = uri.getScheme();
        String url = uri.toString();
        if (scheme == null) {
            return false;
        }
        scheme = scheme.toLowerCase(java.util.Locale.US);

        if ("file".equals(scheme)) {
            // Only the bundled asset origin may be shown in-app.
            if (url.startsWith("file:///android_asset/")) {
                return false;
            }
            return openExternally(url);
        }
        if ("http".equals(scheme) || "https".equals(scheme)) {
            return openExternally(url);
        }
        if ("about".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme)
                || "javascript".equals(scheme)) {
            return false;
        }
        return openExternally(url);
    }

    private boolean openExternally(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "no handler for " + url);
            toast(getString(R.string.no_app_for_link));
        } catch (Throwable t) {
            Log.w(TAG, "could not open " + url, t);
            toast(getString(R.string.no_app_for_link));
        }
        return true;
    }

    private final class ClWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request == null ? null : request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(url == null ? null : Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            pageReady = false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            if (!loadFailed) {
                hideSplash();
            }
            flushPendingShared();
            Log.i(TAG, "web page finished: " + url);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request == null || !request.isForMainFrame()) {
                return;
            }
            CharSequence description = (error == null) ? "unknown" : error.getDescription();
            Log.e(TAG, "main-frame load error: " + description);
            showLoadError(description == null ? null : description.toString());
        }
    }

    private final class ClWebChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                        FileChooserParams params) {
            if (fileChooserCallback != null) {
                try {
                    fileChooserCallback.onReceiveValue(null);
                } catch (Throwable ignored) {
                    // Stale callback, nothing to do.
                }
            }
            fileChooserCallback = callback;
            try {
                // ACTION_OPEN_DOCUMENT shows the system picker and never needs a permission.
                // "*/*" is used on purpose: .cif/.xyz/.vesta have no reliable MIME type on
                // every file provider, so filtering would hide the files we care about.
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                if (params != null) {
                    Log.d(TAG, "file chooser requested, accept=" + joinAcceptTypes(params.getAcceptTypes())
                            + " mode=" + params.getMode());
                }
                startActivityForResult(intent, REQ_FILE_CHOOSER);
                return true;
            } catch (ActivityNotFoundException e) {
                Log.e(TAG, "no ACTION_OPEN_DOCUMENT handler", e);
                fileChooserCallback = null;
                if (callback != null) {
                    callback.onReceiveValue(null);
                }
                toast(getString(R.string.no_file_picker));
                return false;
            }
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
            if (consoleMessage == null) {
                return false;
            }
            String line = consoleMessage.message() + " ("
                    + consoleMessage.sourceId() + ":" + consoleMessage.lineNumber() + ")";
            if (consoleMessage.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                Log.e(TAG_WEB, line);
            } else if (consoleMessage.messageLevel() == ConsoleMessage.MessageLevel.WARNING) {
                Log.w(TAG_WEB, line);
            } else {
                Log.i(TAG_WEB, line);
            }
            return true;
        }

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            // Drop the splash as soon as the page has visibly painted; onPageFinished is the
            // authoritative hook but this removes the black-cover earlier on slow devices.
            if (newProgress >= 85 && !loadFailed) {
                hideSplash();
            }
        }
    }

    private static String joinAcceptTypes(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length == 0) {
            return "(none)";
        }
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < acceptTypes.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(acceptTypes[i]);
        }
        return sb.toString();
    }

    // ----------------------------------------------------------------- file picker --

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            deliverFileChooserResult(resultCode, data);
            return;
        }
        if (requestCode == REQ_CREATE_DOCUMENT) {
            if (bridge != null && bridge.handleActivityResult(requestCode, resultCode, data)) {
                return;
            }
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void deliverFileChooserResult(int resultCode, Intent data) {
        ValueCallback<Uri[]> callback = fileChooserCallback;
        if (callback == null) {
            return;
        }
        fileChooserCallback = null;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                ArrayList<Uri> list = new ArrayList<>();
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri uri = clip.getItemAt(i).getUri();
                    if (uri != null) {
                        list.add(uri);
                    }
                }
                if (!list.isEmpty()) {
                    results = list.toArray(new Uri[0]);
                }
            } else if (data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            keepReadPermission(data, results);
        }
        try {
            callback.onReceiveValue(results);
        } catch (Throwable t) {
            Log.w(TAG, "file chooser callback failed", t);
        }
    }

    private void keepReadPermission(Intent data, Uri[] uris) {
        if (data == null || uris == null) {
            return;
        }
        int flags = data.getFlags()
                & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (flags == 0) {
            return;
        }
        for (Uri uri : uris) {
            try {
                getContentResolver().takePersistableUriPermission(uri, flags);
            } catch (Throwable ignored) {
                // Not all providers grant persistable permissions (ACTION_OPEN_DOCUMENT usually
                // does, but some OEM pickers do not). The transient grant is enough for WebView.
            }
        }
    }

    // ------------------------------------------------------------ shared files in ---

    private void handleIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action)) {
            boolean collected = collectFromViewIntent(intent);
            if (!collected) {
                Log.d(TAG, "VIEW intent without a content/file URI");
            }
            return;
        }
        if (Intent.ACTION_SEND.equals(action)) {
            boolean collected = false;
            Uri stream = getStreamExtra(intent);
            if (stream != null) {
                collected = true;
                collectUri(stream);
            } else {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text != null) {
                    collected = true;
                    queueSharedText(text.toString(), "shared-note.txt");
                }
            }
            if (!collected) {
                Log.d(TAG, "SEND intent without a stream");
            }
            return;
        }
        if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uris = getStreamListExtra(intent);
            if (uris != null) {
                for (Uri uri : uris) {
                    if (uri != null) {
                        collectUri(uri);
                    }
                }
            }
            return;
        }
        Log.d(TAG, "unhandled intent action: " + action);
    }

    private boolean collectFromViewIntent(Intent intent) {
        Uri data = intent.getData();
        if (data != null) {
            collectUri(data);
            return true;
        }
        ClipData clip = intent.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) {
                    collectUri(uri);
                }
            }
            return clip.getItemCount() > 0;
        }
        return false;
    }

    @SuppressWarnings({"deprecation", "unchecked"})
    private Uri getStreamExtra(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
            }
            return (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
        } catch (Throwable t) {
            Log.w(TAG, "could not read EXTRA_STREAM", t);
            return null;
        }
    }

    @SuppressWarnings({"deprecation", "unchecked"})
    private ArrayList<Uri> getStreamListExtra(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                return intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class);
            }
            // The pre-API-33 signature returns ArrayList<Parcelable>, so go through a raw
            // collection and filter element types instead of an illegal generic cast.
            Object raw = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (!(raw instanceof ArrayList)) {
                return null;
            }
            ArrayList<Uri> result = new ArrayList<>();
            for (Object item : (ArrayList<?>) raw) {
                if (item instanceof Uri) {
                    result.add((Uri) item);
                }
            }
            return result;
        } catch (Throwable t) {
            Log.w(TAG, "could not read EXTRA_STREAM list", t);
            return null;
        }
    }

    private void collectUri(final Uri uri) {
        final ExecutorService executor = ioExecutor;
        if (uri == null || executor == null) {
            return;
        }
        executor.execute(() -> {
            try {
                String name = queryDisplayName(uri);
                byte[] bytes = readAllBytes(uri, MAX_SHARED_BYTES);
                if (bytes == null) {
                    toast(getString(R.string.file_too_large));
                    return;
                }
                String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
                Log.i(TAG, "shared file read: " + name + " (" + bytes.length + " bytes)");
                enqueueSharedFile(name, base64);
            } catch (Throwable t) {
                Log.w(TAG, "failed to read shared URI " + uri, t);
                toast(getString(R.string.file_read_error));
            }
        });
    }

    private void queueSharedText(String text, String baseName) {
        if (text == null) {
            return;
        }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_SHARED_BYTES) {
            toast(getString(R.string.file_too_large));
            return;
        }
        enqueueSharedFile(baseName, Base64.encodeToString(bytes, Base64.NO_WRAP));
    }

    private void enqueueSharedFile(final String name, final String base64) {
        final SharedFile file = new SharedFile(name, base64);
        mainHandler.post(() -> {
            pendingShared.addLast(file);
            flushPendingShared();
            toast(getString(R.string.opening_file, file.name));
        });
    }

    /** Hands queued files to the web core once the page can accept them. */
    private void flushPendingShared() {
        final WebView view = webView;
        if (!pageReady || loadFailed || view == null) {
            return;
        }
        while (!pendingShared.isEmpty()) {
            SharedFile file = pendingShared.removeFirst();
            try {
                String jsName = JSONObject.quote(file.name);
                String jsBase64 = JSONObject.quote(file.base64);
                String js = "(function(){try{"
                        + "if(typeof window.__clOpenSharedFile==='function'){"
                        + "window.__clOpenSharedFile(" + jsName + "," + jsBase64 + ");"
                        + "}else{console.warn('CrystalLens: __clOpenSharedFile is not defined, shared file dropped: '+"
                        + jsName + ");}"
                        + "}catch(e){console.error('CrystalLens: __clOpenSharedFile failed: '+(e&&e.message));}})();";
                view.evaluateJavascript(js, null);
                Log.i(TAG, "dispatched shared file to web core: " + file.name
                        + " (base64 chars=" + file.base64.length() + ")");
            } catch (Throwable t) {
                Log.e(TAG, "failed to dispatch shared file " + file.name, t);
            }
        }
    }

    private String queryDisplayName(Uri uri) {
        String name = null;
        try (Cursor cursor = getContentResolver().query(
                uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0 && !cursor.isNull(index)) {
                    name = cursor.getString(index);
                }
            }
        } catch (Throwable t) {
            Log.d(TAG, "DISPLAY_NAME query failed for " + uri, t);
        }
        if (name == null || name.trim().isEmpty()) {
            name = uri.getLastPathSegment();
        }
        if (name == null || name.trim().isEmpty()) {
            name = "shared.cif";
        }
        name = name.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        return name;
    }

    /** Reads a content/file URI fully, returning {@code null} when {@code max} bytes are exceeded. */
    private byte[] readAllBytes(Uri uri, long max) throws IOException {
        InputStream input = getContentResolver().openInputStream(uri);
        if (input == null) {
            throw new IOException("openInputStream returned null");
        }
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream(64 * 1024);
            byte[] buffer = new byte[64 * 1024];
            long total = 0L;
            int read;
            while ((read = input.read(buffer)) > 0) {
                total += read;
                if (total > max) {
                    return null;
                }
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } finally {
            try {
                input.close();
            } catch (IOException ignored) {
                // Nothing meaningful to do.
            }
        }
    }

    private void cleanupStaleExports() {
        try {
            File dir = new File(getCacheDir(), WebAppBridge.EXPORT_DIR);
            if (!dir.isDirectory()) {
                return;
            }
            File[] files = dir.listFiles();
            if (files == null) {
                return;
            }
            long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
            for (File file : files) {
                if (file.isFile() && file.lastModified() < cutoff && file.delete()) {
                    Log.d(TAG, "removed stale export " + file.getName());
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "export cleanup failed", t);
        }
    }

    // --------------------------------------------------------------------- back -----

    @Override
    public void onBackPressed() {
        final WebView view = webView;
        if (view == null || !pageReady || loadFailed) {
            confirmExit();
            return;
        }
        try {
            view.evaluateJavascript(
                    "(function(){try{return window.__clHandleBack?window.__clHandleBack():false;}"
                            + "catch(e){console.error('CrystalLens: __clHandleBack failed: '+(e&&e.message));return false;}})()",
                    value -> {
                        boolean handled = "true".equals(value) || "\"true\"".equals(value);
                        if (handled) {
                            lastBackPressAt = 0L;
                        } else {
                            confirmExit();
                        }
                    });
        } catch (Throwable t) {
            Log.w(TAG, "back dispatch failed", t);
            confirmExit();
        }
    }

    /** Double-press-to-exit: first press explains, second press within the window finishes. */
    private void confirmExit() {
        long now = System.currentTimeMillis();
        if (now - lastBackPressAt < BACK_EXIT_WINDOW_MS) {
            lastBackPressAt = 0L;
            finish();
            return;
        }
        lastBackPressAt = now;
        toast(getString(R.string.press_back_again));
    }

    // ------------------------------------------------------------------ helpers -----

    private void toast(final String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        mainHandler.post(() -> {
            try {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
            } catch (Throwable ignored) {
                // Activity may already be gone.
            }
        });
    }
}

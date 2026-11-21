package com.crystallens.android;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * A tiny, dependency-free {@code ContentProvider} that exposes files in
 * {@code cacheDir/exports} under {@code content://com.crystallens.android.files/<name>}.
 *
 * <p>This replaces the AndroidX FileProvider, which the project deliberately avoids.
 * The provider is not exported; access is granted per-URI through
 * {@code Intent.FLAG_GRANT_READ_URI_PERMISSION} plus {@code android:grantUriPermissions="true"}.</p>
 */
public class CacheFileProvider extends ContentProvider {

    public static final String AUTHORITY = "com.crystallens.android.files";

    private static final String TAG = "CrystalLens";
    private static final String MIME_FALLBACK = "application/octet-stream";

    @Override
    public boolean onCreate() {
        try {
            getExportDir();
        } catch (Throwable t) {
            Log.w(TAG, "export directory unavailable", t);
        }
        return true;
    }

    /** Builds the public content URI for an export file name (no path separators allowed). */
    public static Uri getUri(String fileName) {
        String name = (fileName == null || fileName.isEmpty()) ? "crystallens-export.bin" : fileName;
        return new Uri.Builder()
                .scheme("content")
                .authority(AUTHORITY)
                .appendPath(name)
                .build();
    }

    @Override
    public String getType(Uri uri) {
        try {
            return mimeFor(resolve(uri).getName());
        } catch (Throwable t) {
            return MIME_FALLBACK;
        }
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File file;
        try {
            file = resolve(uri);
        } catch (FileNotFoundException e) {
            String[] columns = (projection == null)
                    ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
                    : projection;
            return new MatrixCursor(columns, 0);
        }
        String[] columns = (projection == null)
                ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
                : projection;
        MatrixCursor cursor = new MatrixCursor(columns, 1);
        Object[] row = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) {
                row[i] = file.getName();
            } else if (OpenableColumns.SIZE.equals(columns[i])) {
                row[i] = file.length();
            } else {
                row[i] = null;
            }
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = resolve(uri);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("CacheFileProvider is read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }

    // ------------------------------------------------------------------- helpers ----

    private File getExportDir() throws IOException {
        File dir = new File(getContext().getCacheDir(), WebAppBridge.EXPORT_DIR);
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) {
            throw new IOException("cannot create " + dir);
        }
        return dir;
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        if (uri == null) {
            throw new FileNotFoundException("null uri");
        }
        String name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) {
            throw new FileNotFoundException("missing file name in " + uri);
        }
        // Defensive: a provider path must never be able to escape cacheDir/exports.
        name = name.replace('/', '_').replace('\\', '_');
        if (name.contains("..")) {
            throw new FileNotFoundException("illegal file name in " + uri);
        }
        File directory;
        try {
            directory = getExportDir();
        } catch (IOException e) {
            throw new FileNotFoundException("export directory unavailable");
        }
        File file = new File(directory, name);
        try {
            String base = directory.getCanonicalPath();
            String path = file.getCanonicalPath();
            if (!path.startsWith(base + File.separator)) {
                throw new FileNotFoundException("path escapes export directory");
            }
        } catch (IOException e) {
            throw new FileNotFoundException("bad path for " + uri);
        }
        if (!file.isFile()) {
            throw new FileNotFoundException("no such export: " + name);
        }
        return file;
    }

    private static String mimeFor(String fileName) {
        int dot = (fileName == null) ? -1 : fileName.lastIndexOf('.');
        String extension = (dot >= 0) ? fileName.substring(dot + 1).toLowerCase(java.util.Locale.US) : "";
        if ("cif".equals(extension)) {
            return "chemical/x-cif";
        }
        if ("xyz".equals(extension)) {
            return "chemical/x-xyz";
        }
        if ("vesta".equals(extension)) {
            return "application/octet-stream";
        }
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return (mime != null) ? mime : MIME_FALLBACK;
    }
}

# Project export guide

The project export flow packages every asset needed to continue editing a clip in
Premiere Pro, DaVinci Resolve, or Final Cut Pro. Each export produces a folder
with editor-specific project files, a universal FCPXML timeline, and the media
assets referenced by those timelines.

## Exporting from the desktop app

1. Open any clip in the **Edit** view.
2. Adjust the in/out points if needed and press **Save adjustments** so the
   backend rebuilds the latest media.
3. Click **Export project**. The desktop app calls the local API and downloads a
   `.zip` archive once the backend finishes generating the project files.
4. Double-click the archive to extract a folder named `Short_YYYYMMDD_TOKEN`.
   - Double-click `Project.prproj` to launch Premiere Pro.
   - Double-click `FinalCutProject.fcpxml` for Final Cut Pro.
   - Double-click `ResolveProject.drp` to open DaVinci Resolve. The archive
     embeds Resolve's `Project.xml` along with placeholder config files so the
     application recognises the package when imported.
   - All editors can also import `UniversalExport.fcpxml` directly.

The export button stays disabled while the backend is building an archive. Any
errors are shown inline with guidance to retry.

## API endpoint

- **Method:** `POST`
- **Route:** `/api/accounts/{accountId}/clips/{clipId}/export`
- **Response:** streamed zip file containing the export folder

Install the base `opentimelineio` package to enable timeline generation. If the
dependency is missing the API responds with a `503 Service Unavailable` error
describing how to install it before retrying the export.

`accountId` accepts the special token `__default__` for the default output root.
The archive overwrites any previous export for the same clip.

## Package layout

```
Short_YYYYMMDD_TOKEN/
├── Media/
│   ├── clip_0.00-20.00_r9.0.mp4       # raw horizontal clip
│   ├── clip_0.00-20.00_r9.0.srt       # subtitle cues
│   └── clip_0.00-20.00_r9.0_vertical.mp4  # rendered short
├── Project.prproj                     # Premiere project (XMEML)
├── FinalCutProject.fcpxml             # Final Cut Pro timeline
├── ResolveProject.drp                 # DaVinci Resolve project archive
├── UniversalExport.fcpxml             # Editor-agnostic FCPXML timeline
└── export_manifest.json               # Manifest describing paths and transforms
```

All media references are relative to the folder so the package remains portable.
The manifest documents the layout transform (scale, crop offsets) and the
subtitle cues included in the timelines.

## Example export

Binary archives are not stored in the repository, but you can generate the
sample package locally. Run the helper script below to create a synthetic
project under `docs/examples/project-export/`:

```bash
poetry run python -m server.scripts.generate_project_export_example \
  --output docs/examples/project-export
```

The script writes a fresh export archive (alongside the expanded folder) that
you can import into Premiere Pro, Final Cut Pro, or DaVinci Resolve. Each run
overwrites the previous sample in the output directory so the folder stays
tidy.

## Known limitations

- Color grading settings are not exported. Apply color adjustments directly in
  the target NLE after importing the project.
- Premiere Pro exports rely on the Premiere XML adapter. If Premiere refuses to
  open the project, import `UniversalExport.fcpxml` instead.
- The exported vertical render is included for reference but the timelines use
  the raw horizontal clip plus subtitle overlays so you can continue editing
  without re-encoding.

# Model Gallery Static Site

This folder is the static Gitee Pages build of the model gallery.

## Publish to Gitee Pages

1. Create a Gitee repository.
2. Copy this folder's contents to the repository root.
3. Push to the repository.
4. In Gitee, enable Pages for the selected branch and root directory.

The published version is view-only: model viewing, rotation, OrbitControls, and X-ray transparency work in the browser. Uploading and deleting models are local-app features because Gitee Pages is static hosting.

## Add Models Later

Use the local gallery app to upload or convert new CAD files, then rebuild/copy the static `public` contents into this folder. For public hosting, keep only web assets such as `.stl`, `.obj`, `.glb`, or `.gltf`; do not publish source `.FCStd` files unless you intentionally want to share them.

## Add Articles Or DSL Notes

Add Markdown or HTML pages next to `index.html`, or create folders such as:

- `articles/`
- `dsl/`
- `models/`

Then link them from `index.html` or add a small navigation bar.

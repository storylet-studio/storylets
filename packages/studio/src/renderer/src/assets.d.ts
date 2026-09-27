// An imported image is its URL: Vite resolves it, fingerprints it, and copies it into the build.
declare module "*.png" {
  const url: string;
  export default url;
}

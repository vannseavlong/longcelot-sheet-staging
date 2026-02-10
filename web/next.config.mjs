/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['longcelot-sheet-db'],
  serverExternalPackages: ['googleapis', 'google-auth-library', 'bcryptjs'],
};

export default nextConfig;

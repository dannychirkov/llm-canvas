import NextAuth, { type DefaultSession } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "./prisma"
import { enforceAuthRate, validPasswordInput, withPasswordWork } from "./authHardening"

declare module "next-auth" {
  interface User {
    analyticsEnabled?: boolean
    authVersion?: number
  }
  interface Session {
    user: DefaultSession["user"] & { id: string; analyticsEnabled?: boolean }
  }
}

// Environment-aware secret validation
const getAuthSecret = () => {
  if (!process.env.AUTH_SECRET) {
    // During build time, we allow missing AUTH_SECRET
    // It will be validated at runtime when actually needed
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
      throw new Error('FATAL: AUTH_SECRET is not set in production environment!');
    }
    console.warn('⚠️  Using fallback secret in development/build mode');
    return 'fallback-secret-for-development';
  }
  return process.env.AUTH_SECRET;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: getAuthSecret(),
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        try {
          enforceAuthRate("login")
          if (typeof credentials?.email !== "string" || credentials.email.length > 254 || !validPasswordInput(credentials.password)) return null
          enforceAuthRate("login", credentials.email)
          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email.trim()
            }
          })

          if (!user || !user.passwordHash) {
            return null
          }

          const password = credentials.password
          const isPasswordValid = await withPasswordWork(() => bcrypt.compare(password, user.passwordHash!))

          if (!isPasswordValid) {
            return null
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            analyticsEnabled: user.analyticsEnabled,
            authVersion: user.authVersion,
          }
        } catch {
          return null
        }
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/login"
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id
        token.email = user.email
        token.name = user.name
        token.image = user.image
        token.analyticsEnabled = user.analyticsEnabled
        token.authVersion = user.authVersion ?? 0
      }

      try {
        if (typeof token.id !== "string") return null
        const updatedUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { email: true, name: true, image: true, analyticsEnabled: true, authVersion: true }
        })

        if (!updatedUser || updatedUser.authVersion !== (token.authVersion ?? 0)) return null
        token.authVersion = updatedUser.authVersion
        token.analyticsEnabled = updatedUser.analyticsEnabled
        if (trigger === "update") {
          token.email = updatedUser.email
          token.name = updatedUser.name
          token.image = updatedUser.image
          token.analyticsEnabled = updatedUser.analyticsEnabled
        }
      } catch {
        return null
      }

      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.email = token.email as string
        session.user.name = token.name as string
        session.user.image = token.image as string
        session.user.analyticsEnabled = token.analyticsEnabled === true
      }
      return session
    }
  },
  debug: false
})

export type PasswordStrength = "weak" | "medium" | "strong" | "very-strong"

export interface PasswordRequirements {
  minLength: boolean
  hasUppercase: boolean
  hasLowercase: boolean
  hasNumber: boolean
  hasSpecialChar: boolean
}

export interface PasswordStrengthResult {
  strength: PasswordStrength
  requirements: PasswordRequirements
  score: number // 0-100
}

export function checkPasswordRequirements(password: string): PasswordRequirements {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password),
  }
}

export function calculatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password) {
    return {
      strength: "weak",
      requirements: {
        minLength: false,
        hasUppercase: false,
        hasLowercase: false,
        hasNumber: false,
        hasSpecialChar: false,
      },
      score: 0,
    }
  }

  const requirements = checkPasswordRequirements(password)
  const metRequirements = Object.values(requirements).filter(Boolean).length
  const totalRequirements = Object.keys(requirements).length

  // Calculate base score based on met requirements (0-50 points)
  const baseScore = (metRequirements / totalRequirements) * 50

  // Calculate length bonus (0-30 points)
  let lengthScore = 0
  if (password.length >= 8) lengthScore = 10
  if (password.length >= 12) lengthScore = 20
  if (password.length >= 16) lengthScore = 30

  // Calculate complexity bonus (0-20 points)
  let complexityScore = 0
  const hasMixedCase = requirements.hasUppercase && requirements.hasLowercase
  const hasMultipleTypes = metRequirements >= 3
  if (hasMixedCase) complexityScore += 10
  if (hasMultipleTypes) complexityScore += 10

  const totalScore = Math.min(100, baseScore + lengthScore + complexityScore)

  let strength: PasswordStrength
  if (totalScore < 30) {
    strength = "weak"
  } else if (totalScore < 60) {
    strength = "medium"
  } else if (totalScore < 80) {
    strength = "strong"
  } else {
    strength = "very-strong"
  }

  return {
    strength,
    requirements,
    score: totalScore,
  }
}

export function validatePassword(password: string): { isValid: boolean; error?: string } {
  if (!password) {
    return { isValid: false, error: "Password is required" }
  }

  const requirements = checkPasswordRequirements(password)

  if (!requirements.minLength) {
    return { isValid: false, error: "Password must be at least 8 characters long" }
  }

  if (!requirements.hasUppercase) {
    return { isValid: false, error: "Password must contain at least one uppercase letter" }
  }

  if (!requirements.hasLowercase) {
    return { isValid: false, error: "Password must contain at least one lowercase letter" }
  }

  if (!requirements.hasNumber) {
    return { isValid: false, error: "Password must contain at least one number" }
  }

  if (!requirements.hasSpecialChar) {
    return { isValid: false, error: "Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)" }
  }

  return { isValid: true }
}


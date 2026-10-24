"use client"

import { Check, X } from "lucide-react"
import { calculatePasswordStrength, PasswordStrength } from "@/lib/passwordUtils"
import { cn } from "@/lib/utils"

interface PasswordStrengthIndicatorProps {
  password: string
}

export default function PasswordStrengthIndicator({
  password,
}: PasswordStrengthIndicatorProps) {
  const { strength, requirements, score } = calculatePasswordStrength(password || "")

  const hasPassword = !!password

  const strengthConfig: Record<
    PasswordStrength,
    { label: string; color: string; bgColor: string }
  > = {
    weak: {
      label: "Weak",
      color: "bg-red-500",
      bgColor: "bg-red-500/20",
    },
    medium: {
      label: "Medium",
      color: "bg-yellow-500",
      bgColor: "bg-yellow-500/20",
    },
    strong: {
      label: "Strong",
      color: "bg-green-500",
      bgColor: "bg-green-500/20",
    },
    "very-strong": {
      label: "Very Strong",
      color: "bg-emerald-600",
      bgColor: "bg-emerald-600/20",
    },
  }

  const config = strengthConfig[strength]

  const requirementItems = [
    {
      label: "At least 8 characters",
      met: requirements.minLength,
    },
    {
      label: "Contains uppercase letter",
      met: requirements.hasUppercase,
    },
    {
      label: "Contains lowercase letter",
      met: requirements.hasLowercase,
    },
    {
      label: "Contains number",
      met: requirements.hasNumber,
    },
    {
      label: "Contains special character",
      met: requirements.hasSpecialChar,
    },
  ]

  return (
    <div className="space-y-3 mt-2">
      {hasPassword && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Password strength:</span>
            <span
              className={cn(
                "font-medium",
                strength === "weak" && "text-red-500",
                strength === "medium" && "text-yellow-500",
                strength === "strong" && "text-green-500",
                strength === "very-strong" && "text-emerald-600"
              )}
            >
              {config.label}
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full transition-all",
                config.color
              )}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          Password requirements:
        </p>
        <div className="space-y-1">
          {requirementItems.map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-2 text-xs"
            >
              {item.met ? (
                <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
              ) : (
                <X className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <span
                className={cn(
                  item.met ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


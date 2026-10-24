import React from 'react'
import { Link } from 'react-router-dom'

export function JobliteBrand({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`jl-shared-brand ${className}`.trim()} aria-label="Joblite AHS home">
      <span className="jl-shared-mark" aria-hidden="true">J<span /></span>
      <span>Joblite AHS</span>
    </Link>
  )
}

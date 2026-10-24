import React from 'react'
import { Link } from 'react-router-dom'

export function JobliteBrand({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`jl-shared-brand ${className}`.trim()} aria-label="Joblite AHIS home">
      <img className="jl-brand-image" src="/joblite.png" alt="" />
      <span>Joblite AHIS</span>
    </Link>
  )
}

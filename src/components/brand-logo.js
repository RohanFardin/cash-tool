import Image from 'next/image'
import logo from '@/joarder-logo.png'

export function BrandLogo({ large = false }) {
  const size = large ? 56 : 40
  return <Image src={logo} alt="Joarder Pharmacy logo" width={size} height={size} className={`brand-mark${large ? ' large' : ''}`} />
}

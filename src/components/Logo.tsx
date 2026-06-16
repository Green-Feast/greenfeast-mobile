import { Image } from 'expo-image'

interface LogoProps {
  size?: number
}

export default function Logo({ size = 64 }: LogoProps) {
  return (
    <Image
      source={require('../../assets/images/logo.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
    />
  )
}

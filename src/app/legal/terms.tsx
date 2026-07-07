import LegalDocScreen from '@/components/LegalDocScreen'
import { TERMS_TEXT } from '@/constants/legal'

export default function TermsScreen() {
  return <LegalDocScreen title="Terms & Conditions" body={TERMS_TEXT} />
}

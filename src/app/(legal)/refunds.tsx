import LegalDocScreen from '@/components/LegalDocScreen'
import { REFUNDS_TEXT } from '@/constants/legal'

export default function RefundsScreen() {
  return <LegalDocScreen title="Refunds & Cancellations" body={REFUNDS_TEXT} />
}

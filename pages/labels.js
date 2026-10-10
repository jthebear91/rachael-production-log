import Head from 'next/head'
import DayDocLabels from '../components/DayDocLabels'

// Open crew page, same as Daily Log and Batch Tracker. Sales stays the
// only PIN-gated screen.
export default function LabelsPage() {
  return (
    <>
      <Head>
        <title>Day Doc Labels</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <DayDocLabels />
    </>
  )
}

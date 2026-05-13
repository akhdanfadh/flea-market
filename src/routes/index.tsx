import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">Hello, flea market</h1>
      <p className="mt-4 text-lg">
        <Link to="/page-two" className="text-blue-600 underline">
          Page two
        </Link>
      </p>
    </div>
  )
}

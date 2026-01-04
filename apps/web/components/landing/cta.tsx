import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"

export function CTA() {
  return (
    <section className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">Ready to store smarter?</h2>
          <p className="mb-8 text-lg text-muted-foreground">
            Join thousands of users who trust Nexus with their most important files.
          </p>
          <Link href="/sign-up">
            <Button size="lg">
              Start storing free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <p className="mt-4 text-sm text-muted-foreground">No credit card required. 5 GB free forever.</p>
        </div>
      </div>
    </section>
  )
}

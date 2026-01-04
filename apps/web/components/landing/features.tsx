import { Shield, Wallet, Clock, Lock, Globe, Headphones } from "lucide-react"

const features = [
  {
    icon: Wallet,
    title: "90% cost savings",
    description: "Pay $1/TB/month instead of $10+ with traditional cloud storage.",
  },
  {
    icon: Shield,
    title: "11 nines durability",
    description: "99.999999999% durability. Your files aren't going anywhere.",
  },
  {
    icon: Clock,
    title: "3-12 hour retrieval",
    description: "Request your files anytime. They're available within hours.",
  },
  {
    icon: Lock,
    title: "End-to-end encryption",
    description: "Your files are encrypted at rest and in transit. Always.",
  },
  {
    icon: Globe,
    title: "No AWS knowledge needed",
    description: "We handle all the complexity. You just upload and download.",
  },
  {
    icon: Headphones,
    title: "Human support",
    description: "Real people ready to help when you need it.",
  },
]

export function Features() {
  return (
    <section id="features" className="border-t border-border bg-muted/30 py-20 md:py-28">
      <div className="container mx-auto px-4">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">Everything you need</h2>
          <p className="text-lg text-muted-foreground">Enterprise-grade archival storage, made simple.</p>
        </div>
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

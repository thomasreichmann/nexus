import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Check } from "lucide-react"

const plans = [
  {
    name: "Starter",
    storage: "100 GB",
    price: "$2",
    current: true,
  },
  {
    name: "Pro",
    storage: "1 TB",
    price: "$9",
    current: false,
  },
  {
    name: "Business",
    storage: "5 TB",
    price: "$39",
    current: false,
  },
]

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and subscription</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Update your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" defaultValue="John Doe" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" defaultValue="john@example.com" />
            </div>
          </div>
          <Button>Save changes</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>Manage your storage plan</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-lg border p-4 ${
                  plan.current ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                {plan.current && <Badge className="absolute -top-2 right-2">Current</Badge>}
                <h3 className="font-semibold">{plan.name}</h3>
                <p className="text-sm text-muted-foreground">{plan.storage}</p>
                <p className="mt-2 text-2xl font-bold">
                  {plan.price}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                {!plan.current && (
                  <Button variant="outline" size="sm" className="mt-3 w-full bg-transparent">
                    Upgrade
                  </Button>
                )}
                {plan.current && (
                  <div className="mt-3 flex items-center gap-1 text-sm text-primary">
                    <Check className="h-4 w-4" />
                    Active
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Change your password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input id="confirm-password" type="password" />
          </div>
          <Button>Update password</Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible and destructive actions</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive">Delete account</Button>
        </CardContent>
      </Card>
    </div>
  )
}

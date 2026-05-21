static class Parser
{
    public static (int, int) ReadNumbers()
    {
        var parts = Console.ReadLine()!.Split();
        return (int.Parse(parts[0]), int.Parse(parts[1]));
    }
}

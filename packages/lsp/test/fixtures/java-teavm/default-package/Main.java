public class Main {
    public static void main(String[] args) {
        int answer = doubleValue(21);
        System.out.println(answer + args.length);
    }

    /** Doubles a value. */
    public static int doubleValue(int value) {
        return value * 2;
    }
}

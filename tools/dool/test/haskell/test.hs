main :: IO ()
main = do
    first <- readLn
    second <- readLn
    print (first + second :: Int)

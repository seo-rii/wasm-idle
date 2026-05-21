# run passed argument with user "test" (ex: `./test.sh gcc -o test test.c` then executes `su -m test -c "gcc -o test test.c"`

chmod -R 777 /test
cd /test
su -m test -c 'cd /test; sh -c "$@"' _ "$@"
exit_status=$?

if [ $exit_status -ne 0 ]; then
    echo "An error occurred with exit status: $exit_status"
    exit $exit_status
fi
rm -rf /test